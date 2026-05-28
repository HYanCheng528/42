#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { fetchActivity, fetchMarkets } from "./fortytwo.js";
import { isEventMarket, isPriceMarket, marketDurationHours, passesMinimumDuration } from "./event-strategy.js";
import { markdownLine, notifyPushPlusSafe, shortHash } from "./pushplus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dashboardConfig = readConfig();
const botWallet = process.env.DASHBOARD_WALLET ?? dashboardConfig.walletAddress ?? "0x244FcE72db40B69C4DA4D41F0a76E25B24CA201b";
const host = process.env.DASHBOARD_HOST ?? "127.0.0.1";
const port = Number(process.env.DASHBOARD_PORT ?? 4242);
const launchLabel = "com.myandong.42space-event-arm";
const systemdService = process.env.BOT_SYSTEMD_SERVICE ?? "42space-event-arm.service";
const fillsFile = path.join(rootDir, "data/fills.jsonl");
const actionsFile = path.join(rootDir, "data/dashboard-actions.jsonl");
const localEnvFile = resolveConfigEditorFile();
const localEnvFileLabel = displayConfigEditorFile(localEnvFile);
const runtimeStatusFile = resolveRuntimeStatusFile();
const dashboardPassword = process.env.DASHBOARD_PASSWORD ?? "";
const dashboardAuthSecret = process.env.DASHBOARD_AUTH_SECRET || dashboardPassword;
const dashboardAuthFailRedirect = process.env.DASHBOARD_AUTH_FAIL_REDIRECT ?? "https://www.baidu.com/";
const dashboardAuthCookie = process.env.DASHBOARD_AUTH_COOKIE ?? "ft42_dashboard";
const dashboardAuthMaxAgeSeconds = Number(process.env.DASHBOARD_AUTH_MAX_AGE_SECONDS ?? 604800);
const loginFailures = new Map();
const marketMintTopic = "0xf2e90b10bd525a6b1fe02d09e8133d3e38c9a87376ed4850904ca21e6e27abec";
let buySpeedCache = null;
let buySpeedPromise = null;

const configFields = [
  { key: "DRY_RUN", type: "boolean" },
  { key: "EXECUTE", type: "boolean" },
  { key: "I_UNDERSTAND_42_PRICE_MARKET_RISK", type: "ack" },
  { key: "I_AM_NOT_IN_RESTRICTED_JURISDICTION", type: "ack" },
  { key: "STAKE_PER_OUTCOME_USDT", type: "number", min: 0.01 },
  { key: "EVENT_OUTCOME_COUNT", type: "integer", min: 1 },
  { key: "MAX_MARKET_STAKE_USDT", type: "number", min: 0.01 },
  { key: "MAX_BATCH_STAKE_USDT", type: "number", min: 0.01 },
  { key: "EVENT_OPEN_WINDOW_SECONDS", type: "integer", min: 1 },
  { key: "GAS_PRICE_GWEI", type: "number", min: 0.01 },
  { key: "EVENT_DISCOVERY", type: "enum", values: ["ws", "chain", "rest"] },
  { key: "REST_DISCOVERY_ENABLED", type: "boolean" },
  { key: "REST_DISCOVERY_POLL_MS", type: "integer", min: 1 },
  { key: "WATCH_SCAN_LIMIT", type: "integer", min: 1 },
  { key: "MIN_MARKET_DURATION_HOURS", type: "number", min: 0 },
  { key: "EVENT_BUY_MODE", type: "enum", values: ["fast", "quoted"] },
  { key: "EVENT_OUTCOME_SELECTION", type: "enum", values: ["lowest_odds", "all"] },
  { key: "EVENT_OUTCOME_SELECTION_FALLBACK", type: "enum", values: ["token_order", "error"] },
  { key: "WATCH_BUY_EXISTING", type: "boolean" },
  { key: "AUTO_SELL_ENABLED", type: "boolean" },
  { key: "AUTO_SELL_PROFIT_MULTIPLIER", type: "number", min: 1.01 },
  { key: "AUTO_SELL_PERCENT", type: "number", min: 1, max: 100 }
];

let overviewCache = null;
let overviewPromise = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
    if (url.pathname === "/login" && req.method === "GET") {
      return serveLogin(res);
    }
    if (url.pathname === "/login" && req.method === "POST") {
      return handleLogin(req, res);
    }
    if (url.pathname === "/logout") {
      clearAuthCookie(req, res);
      return redirect(res, "/login");
    }
    if (url.pathname === "/assets/icon.svg" && req.method === "GET") {
      return serveFile(res, path.join(publicDir, "assets", "icon.svg"), "image/svg+xml; charset=utf-8");
    }
    if (!isAuthenticated(req)) {
      return rejectUnauthenticated(req, res, url);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveFile(res, path.join(publicDir, "dashboard.html"), "text/html; charset=utf-8");
    }
    if (url.pathname.startsWith("/assets/")) {
      return serveStatic(res, url.pathname);
    }
    if (url.pathname === "/api/overview" && req.method === "GET") {
      return sendJson(res, await getOverview());
    }
    if (url.pathname === "/api/config" && req.method === "GET") {
      return sendJson(res, getConfigEditorState());
    }
    if (url.pathname === "/api/config" && req.method === "POST") {
      return sendJson(res, saveConfigEditorState(await readJsonBody(req)));
    }
    if (url.pathname === "/api/watch/restart" && req.method === "POST") {
      return sendJson(res, await restartWatchService());
    }
    if (url.pathname === "/api/approve" && req.method === "POST") {
      return sendJson(res, await approveRouter(await readJsonBody(req)));
    }
    if (url.pathname === "/api/sell/quote" && req.method === "POST") {
      return sendJson(res, await sellQuote(await readJsonBody(req)));
    }
    if (url.pathname === "/api/sell/execute" && req.method === "POST") {
      return sendJson(res, await sellExecute(await readJsonBody(req)));
    }
    sendJson(res, { ok: false, message: "Not found" }, 404);
  } catch (error) {
    sendJson(res, { ok: false, message: cleanError(error) }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`42 dashboard listening on http://${host}:${port}`);
});

async function getOverview() {
  const now = Date.now();
  if (overviewCache && now - overviewCache.at < 4000) return overviewCache.data;
  if (overviewPromise) return overviewPromise;
  overviewPromise = buildOverview()
    .then((data) => {
      overviewCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      overviewPromise = null;
    });
  return overviewPromise;
}

async function buildOverview() {
  const cfg = readConfig();
  const [status, positions, walletActivity, newMarkets, bot, buySpeed] = await Promise.all([
    runEvent(["status", "--wallet", botWallet], { timeoutMs: 30000 }),
    runEvent(["positions", "--wallet", botWallet], { timeoutMs: 30000 }),
    fetchUserActivity(),
    fetchNewMarketsFeed(),
    getBotState(),
    getBuySpeedStats(cfg)
  ]);
  const holdings = normalizeHoldings(positions);
  const recentRows = readRecentActivity();
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    bot: normalizeBot(bot, status),
    wallet: normalizeWallet(status.wallet),
    next: normalizeNext(status),
    newMarkets: normalizeNewMarkets(newMarkets, status, walletActivity, recentRows),
    holdings,
    analytics: buildAnalytics(positions, walletActivity),
    activity: normalizeActivity(recentRows, walletActivity),
    buySpeed,
    settings: {
      stakeText: `${status.watchConfig?.eventOutcomeCount ?? cfg.eventOutcomeCount ?? 5} 档 / ${status.watchConfig?.stakePerOutcomeUsdt ?? cfg.stakePerOutcomeUsdt ?? 5}U`,
      windowText: `${status.watchConfig?.eventOpenWindowSeconds ?? 60}s`,
      autoSellText: autoSellText(status.watchConfig, cfg),
      runtimeStatus: normalizeRuntimeStatus(readRuntimeStatus(), bot),
      config: configEditorPayload(cfg)
    }
  };
}

function getConfigEditorState() {
  return {
    ok: true,
    config: configEditorPayload(readConfig())
  };
}

function saveConfigEditorState(body) {
  const values = body?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Missing config values");
  }

  const parsed = {};
  for (const field of configFields) {
    if (!(field.key in values)) continue;
    parsed[field.key] = parseConfigField(field, values[field.key]);
  }

  if (Object.keys(parsed).length === 0) {
    throw new Error("No editable config values supplied");
  }

  writeEnvValues(localEnvFile, parsed);
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }
  overviewCache = null;

  return {
    ok: true,
    config: configEditorPayload(readConfig())
  };
}

async function restartWatchService() {
  if (process.platform !== "linux") {
    throw new Error("Watch restart is only supported on the Linux VPS");
  }
  if (!/^[A-Za-z0-9_.@-]+\.service$/.test(systemdService)) {
    throw new Error("Invalid BOT_SYSTEMD_SERVICE");
  }

  const controller = await restartSystemdService(systemdService);
  overviewCache = null;
  const bot = await getSystemdBotState();
  return {
    ok: true,
    service: systemdService,
    controller,
    bot,
    message: bot.running ? "Watch 已重启" : "已提交重启，等待启动"
  };
}

async function restartSystemdService(service) {
  try {
    await execFileAsync("systemctl", ["restart", service], { timeoutMs: 20000 });
    return "systemctl";
  } catch (directError) {
    try {
      await execFileAsync("sudo", ["-n", "systemctl", "restart", service], { timeoutMs: 20000 });
      return "sudo";
    } catch (sudoError) {
      sudoError.message = `Watch restart failed: ${cleanError(sudoError) || cleanError(directError)}`;
      throw sudoError;
    }
  }
}

function configEditorPayload(cfg) {
  const raw = readEnvFile(localEnvFile);
  const values = {};
  for (const field of configFields) {
    values[field.key] = raw[field.key] ?? configValueFromRuntime(field.key, cfg);
  }
  return {
    file: localEnvFileLabel,
    values,
    runtime: {
      dryRun: cfg.dryRun,
      execute: cfg.execute,
      walletAddress: cfg.walletAddress || null,
      privateKeyLoaded: Boolean(cfg.privateKey),
      rpcConfigured: Boolean(cfg.rpcUrl),
      wsConfigured: Boolean(cfg.wsUrl)
    }
  };
}

function configValueFromRuntime(key, cfg) {
  const mapping = {
    DRY_RUN: cfg.dryRun ? "1" : "0",
    EXECUTE: cfg.execute ? "1" : "0",
    I_UNDERSTAND_42_PRICE_MARKET_RISK: cfg.riskAck === "YES" ? "YES" : "NO",
    I_AM_NOT_IN_RESTRICTED_JURISDICTION: cfg.eligibilityAck === "YES" ? "YES" : "NO",
    STAKE_PER_OUTCOME_USDT: cfg.stakePerOutcomeUsdt,
    EVENT_OUTCOME_COUNT: cfg.eventOutcomeCount,
    MAX_MARKET_STAKE_USDT: cfg.maxMarketStakeUsdt,
    MAX_BATCH_STAKE_USDT: cfg.maxBatchStakeUsdt,
    EVENT_OPEN_WINDOW_SECONDS: cfg.eventOpenWindowSeconds,
    GAS_PRICE_GWEI: cfg.gasPriceGwei,
    EVENT_DISCOVERY: cfg.eventDiscovery,
    REST_DISCOVERY_ENABLED: cfg.restDiscoveryEnabled ? "1" : "0",
    REST_DISCOVERY_POLL_MS: cfg.restDiscoveryPollMs,
    WATCH_SCAN_LIMIT: cfg.watchScanLimit,
    MIN_MARKET_DURATION_HOURS: cfg.minMarketDurationHours,
    EVENT_BUY_MODE: cfg.eventBuyMode,
    EVENT_OUTCOME_SELECTION: cfg.eventOutcomeSelection,
    EVENT_OUTCOME_SELECTION_FALLBACK: cfg.eventOutcomeSelectionFallback,
    WATCH_BUY_EXISTING: cfg.watchBuyExisting ? "1" : "0",
    AUTO_SELL_ENABLED: cfg.autoSellEnabled ? "1" : "0",
    AUTO_SELL_PROFIT_MULTIPLIER: cfg.autoSellProfitMultiplier,
    AUTO_SELL_PERCENT: cfg.autoSellPercent
  };
  return String(mapping[key] ?? "");
}

function parseConfigField(field, value) {
  if (field.type === "boolean") return truthyConfigValue(value) ? "1" : "0";
  if (field.type === "ack") return truthyConfigValue(value) ? "YES" : "NO";
  if (field.type === "enum") {
    const normalized = String(value ?? "").trim();
    if (!field.values.includes(normalized)) {
      throw new Error(`${field.key} must be one of ${field.values.join(", ")}`);
    }
    return normalized;
  }
  if (field.type === "integer" || field.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${field.key} must be a number`);
    if (field.type === "integer" && !Number.isInteger(number)) throw new Error(`${field.key} must be an integer`);
    if (field.min !== undefined && number < field.min) throw new Error(`${field.key} must be >= ${field.min}`);
    if (field.max !== undefined && number > field.max) throw new Error(`${field.key} must be <= ${field.max}`);
    return String(number);
  }
  return String(value ?? "").trim();
}

function truthyConfigValue(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = unquoteEnvValue(match[2].trim());
  }
  return values;
}

function writeEnvValues(file, values) {
  ensureParentDir(file);
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const remaining = new Set(Object.keys(values));
  const updated = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$/);
    if (!match || !remaining.has(match[2])) return line;
    remaining.delete(match[2]);
    return `${match[1]}${match[2]}${match[3]}${formatEnvValue(values[match[2]])}`;
  });
  for (const key of remaining) {
    if (updated.length > 0 && updated.at(-1) !== "") updated.push("");
    updated.push(`${key}=${formatEnvValue(values[key])}`);
  }
  fs.writeFileSync(file, `${updated.join("\n").replace(/\s+$/u, "")}\n`);
}

function resolveConfigEditorFile() {
  return path.resolve(rootDir, process.env.DASHBOARD_CONFIG_FILE || process.env.BOT_CONFIG_FILE || ".env.local");
}

function displayConfigEditorFile(file) {
  const relative = path.relative(rootDir, file);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return file;
}

function resolveRuntimeStatusFile() {
  return path.resolve(rootDir, process.env.RUNTIME_STATUS_FILE || "data/runtime-status.json");
}

function readRuntimeStatus() {
  try {
    const text = fs.readFileSync(runtimeStatusFile, "utf8");
    const stat = fs.statSync(runtimeStatusFile);
    return {
      ...JSON.parse(text),
      file: displayConfigEditorFile(runtimeStatusFile),
      fileMtime: stat.mtime.toISOString()
    };
  } catch {
    return null;
  }
}

function normalizeRuntimeStatus(row, bot) {
  if (!row) {
    return {
      present: false,
      stateText: bot.running ? "无运行快照" : "Watch 未运行",
      tone: bot.running ? "warn" : "neutral"
    };
  }
  const serviceStartedMs = Date.parse(bot.startedAt ?? "");
  const snapshotMs = Date.parse(row.startedAt ?? row.fileMtime ?? "");
  const stale = Boolean(bot.running && serviceStartedMs && snapshotMs && snapshotMs + 15000 < serviceStartedMs);
  return {
    present: true,
    stale,
    tone: !bot.running ? "bad" : stale ? "warn" : "good",
    stateText: !bot.running ? "Watch 未运行" : stale ? "快照可能过期" : "Watch 运行中",
    file: row.file,
    fileMtime: row.fileMtime,
    startedAt: row.startedAt,
    command: row.command,
    pid: row.pid ?? null,
    servicePid: bot.pid ?? null,
    mode: row.mode,
    walletAddress: row.walletAddress ?? null,
    dataSources: row.dataSources ?? {},
    strategy: row.strategy ?? {},
    execution: row.execution ?? {},
    autoSell: row.autoSell ?? {},
    preflight: row.watchPreflight ?? null,
    configSources: row.configSources ?? {}
  };
}

function ensureParentDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function formatEnvValue(value) {
  const text = String(value);
  return /[\s#"'\\]/.test(text) ? JSON.stringify(text) : text;
}

function autoSellText(watchConfig, cfg) {
  const enabled = Boolean(watchConfig?.autoSellEnabled ?? cfg.autoSellEnabled);
  if (!enabled) return "关闭";
  return `${watchConfig?.autoSellProfitMultiplier ?? cfg.autoSellProfitMultiplier}x / 卖 ${watchConfig?.autoSellPercent ?? cfg.autoSellPercent}%`;
}

async function approveRouter(body) {
  const amount = Number(body?.amountUsdt ?? body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid approval amount");

  const result = await runEvent(["approve", "--amount-usdt", String(amount)], {
    timeoutMs: 180000,
    env: {
      DRY_RUN: "0",
      EXECUTE: "1",
      I_UNDERSTAND_42_PRICE_MARKET_RISK: "YES",
      I_AM_NOT_IN_RESTRICTED_JURISDICTION: "YES",
      NO_GUI_PROMPT: "1"
    }
  });
  const approval = normalizeApproval(result);
  appendJsonl(actionsFile, {
    type: "approve",
    at: new Date().toISOString(),
    question: "BUSDT 授权",
    amount: approval.allowance,
    status: approval.approved ? "submitted" : "unchanged",
    txHash: approval.approveHash ?? null,
    resetHash: approval.resetHash ?? null
  });
  notifyPushPlusSafe(readConfig(), {
    title: approval.approved ? "42space 已提交授权" : "42space 授权已满足",
    content: [
      markdownLine("额度", approval.allowance ? `${approval.allowance} U` : ""),
      markdownLine("交易", shortHash(approval.approveHash)),
      markdownLine("重置交易", shortHash(approval.resetHash))
    ].filter(Boolean).join("\n")
  });
  overviewCache = null;
  return {
    ok: true,
    approval
  };
}

async function sellQuote(body) {
  const args = sellArgs(body);
  const result = await runEvent(["sell", "--wallet", botWallet, ...args], { timeoutMs: 30000 });
  return {
    ok: true,
    quote: normalizeSellQuote(result)
  };
}

async function sellExecute(body) {
  const args = sellArgs(body);
  const result = await runEvent(["sell", "--wallet", botWallet, ...args], {
    timeoutMs: 120000,
    env: {
      DRY_RUN: "0",
      EXECUTE: "1",
      I_UNDERSTAND_42_PRICE_MARKET_RISK: "YES",
      I_AM_NOT_IN_RESTRICTED_JURISDICTION: "YES",
      NO_GUI_PROMPT: "1"
    }
  });
  const summary = normalizeSellExecution(result);
  appendJsonl(actionsFile, {
    type: "sell",
    at: new Date().toISOString(),
    question: summary.title,
    outcome: summary.outcome,
    amount: summary.receivedText,
    status: summary.status,
    rawStatus: summary.rawStatus,
    txHash: summary.txHash,
    receiptError: summary.receiptError
  });
  notifyPushPlusSafe(readConfig(), {
    title: `42space 卖出${summary.status ?? ""}`,
    content: [
      markdownLine("市场", summary.title),
      markdownLine("选项", summary.outcome),
      markdownLine("收回", summary.receivedText),
      markdownLine("交易", shortHash(summary.txHash)),
      markdownLine("错误", summary.receiptError)
    ].filter(Boolean).join("\n")
  });
  overviewCache = null;
  return {
    ok: true,
    sell: summary
  };
}

function sellArgs(body) {
  if (!body?.market) throw new Error("Missing market");
  const percent = Number(body.percent ?? 100);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error("Invalid percent");
  const args = ["--market", String(body.market), "--percent", String(percent)];
  if (body.all) {
    args.push("--all");
  } else {
    if (!body.tokenId) throw new Error("Missing token");
    args.push("--token-id", String(body.tokenId));
  }
  return args;
}

function normalizeBot(bot, status) {
  const waitingFunds = status.wallet && (!status.wallet.balanceReady || !status.wallet.allowanceReady || !status.wallet.bnbReady);
  return {
    running: bot.running,
    label: bot.running ? (waitingFunds ? "等待资金" : "运行中") : "未运行",
    tone: bot.running && !waitingFunds ? "good" : "warn",
    message: waitingFunds ? fundingMessage(status.wallet) : bot.message
  };
}

function normalizeWallet(wallet) {
  if (!wallet) return null;
  return {
    busdt: money(wallet.busdtBalance),
    allowance: money(wallet.busdtAllowanceToRouter),
    required: money(wallet.requiredBusdt),
    minimumRequired: money(wallet.minimumRequiredBusdt ?? wallet.requiredBusdt),
    fullBatchRequired: money(wallet.fullBatchRequiredBusdt ?? wallet.requiredBusdt),
    bnb: Number(wallet.bnbBalance ?? 0).toFixed(6),
    allowanceReady: Boolean(wallet.allowanceReady),
    balanceReady: Boolean(wallet.balanceReady),
    bnbReady: Boolean(wallet.bnbReady),
    fullBatchReady: Boolean(wallet.fullBatchReady),
    fullBatchBalanceReady: Boolean(wallet.fullBatchBalanceReady),
    fullBatchAllowanceReady: Boolean(wallet.fullBatchAllowanceReady),
    ready: Boolean(wallet.balanceReady && wallet.allowanceReady && wallet.bnbReady),
    message: fundingMessage(wallet)
  };
}

function fundingMessage(wallet) {
  if (!wallet) return "";
  const minimumRequired = Number(wallet.minimumRequiredBusdt ?? wallet.requiredBusdt ?? 0);
  const fullRequired = Number(wallet.fullBatchRequiredBusdt ?? wallet.requiredBusdt ?? minimumRequired);
  if (wallet.balanceReady && wallet.allowanceReady && wallet.bnbReady) {
    const fullMissing = Math.max(0, fullRequired - Number(wallet.busdtBalance ?? 0));
    if (wallet.fullBatchReady === false && fullMissing > 0) return `可买部分；完整批次差 ${money(fullMissing)} U`;
    const fullAllowanceMissing = Math.max(0, fullRequired - Number(wallet.busdtAllowanceToRouter ?? 0));
    if (wallet.fullBatchReady === false && fullAllowanceMissing > 0) return `可买部分；完整批次需再授权 ${money(fullAllowanceMissing)} U`;
    return "资金够";
  }
  const missing = Math.max(0, minimumRequired - Number(wallet.busdtBalance ?? 0));
  if (missing > 0) return `差 ${money(missing)} U`;
  const missingAllowance = Math.max(0, minimumRequired - Number(wallet.busdtAllowanceToRouter ?? 0));
  if (missingAllowance > 0) return `需授权 ${money(missingAllowance)} U`;
  return "需要补 BNB";
}

function normalizeNext(status) {
  const markets = status.future ?? [];
  const next = markets[0] ?? null;
  const limit = Math.max(6, Number(process.env.DASHBOARD_UPCOMING_LIMIT ?? 30));
  return {
    count: markets.length,
    items: markets.slice(0, limit).map((market) => ({
      title: market.question,
      startsAt: market.startDate,
      stake: money(market.totalStakeUsdt),
      choices: market.outcomeCount,
      ready: Boolean(market.prepared)
    })),
    first: next ? {
      title: next.question,
      startsAt: next.startDate,
      stake: money(next.totalStakeUsdt),
      choices: next.outcomeCount,
      ready: Boolean(next.prepared)
    } : null
  };
}

function normalizeNewMarkets(markets, status, walletRows, localRows) {
  const cfg = readConfig();
  const openWindowSeconds = Number(status.watchConfig?.eventOpenWindowSeconds ?? cfg.eventOpenWindowSeconds ?? 60);
  const bought = boughtMarketSet(walletRows, localRows);
  const skipped = skippedMarketSet(localRows);
  const future = new Map((status.future ?? []).map((market) => [normAddress(market.address), market]));
  const rows = [];
  let excluded = 0;

  for (const market of markets) {
    const rejectionReason = marketRejectionReason(market, cfg);
    if (rejectionReason) {
      excluded += 1;
      rows.push(rejectedMarketRow(market, rejectionReason));
      continue;
    }
    const key = normAddress(market.address);
    const pending = future.get(key);
    const context = { bought, skipped, pending, openWindowSeconds };
    const choices = Math.min(Number(status.watchConfig?.eventOutcomeCount ?? cfg.eventOutcomeCount ?? 5), market.outcomes?.length ?? 0);
    const state = marketState(market, context);
    rows.push({
      title: market.question,
      category: firstCategory(market),
      startsAt: market.startDate,
      choices,
      stake: money(Number(status.watchConfig?.stakePerOutcomeUsdt ?? cfg.stakePerOutcomeUsdt ?? 5) *
        choices),
      state,
      tone: marketTone(market, context),
      bucket: marketBucketFor(market, context),
      meta: marketMeta(firstCategory(market), choices)
    });
  }

  return {
    count: rows.length,
    excluded,
    eligibleCount: rows.length - excluded,
    items: rows.slice(0, Number(process.env.DASHBOARD_MARKET_ROWS_LIMIT ?? 120))
  };
}

function marketRejectionReason(market, cfg) {
  if (!market) return "数据为空";
  if (!["live", "not_started"].includes(String(market.status ?? ""))) return `状态 ${market.status ?? "unknown"}`;
  if (!Array.isArray(market.outcomes) || market.outcomes.length === 0) return "没有选项";
  if (isPriceMarket(market, cfg)) return "价格/8小时盘";
  if (!passesDashboardCategoryAllowlist(market, cfg)) return "分类不匹配";
  if (!passesMinimumDuration(market, cfg)) {
    return `时长不足 ${Number(cfg.minMarketDurationHours ?? 48)}h`;
  }
  if (!isEventMarket(market, cfg, { statuses: ["live", "not_started"] })) return "策略未匹配";
  return "";
}

function rejectedMarketRow(market, reason) {
  const category = firstCategory(market);
  const duration = marketDurationText(market);
  return {
    title: market.question ?? market.slug ?? market.address ?? "Unknown market",
    category,
    startsAt: market.startDate,
    choices: market.outcomes?.length ?? 0,
    stake: "-",
    state: "被刷掉",
    tone: "neutral",
    bucket: "rejected",
    reason,
    meta: [category || "Market", duration, reason].filter(Boolean).join(" · ")
  };
}

function passesDashboardCategoryAllowlist(market, cfg) {
  if (!cfg.marketCategoryAllowlist || cfg.marketCategoryAllowlist.length === 0) return true;
  return containsAnyDashboard((market.categories ?? []).join(" "), cfg.marketCategoryAllowlist);
}

function containsAnyDashboard(text, needles = []) {
  const normalized = String(text ?? "").toLowerCase();
  return needles.some((needle) => normalized.includes(String(needle).toLowerCase()));
}

function boughtMarketSet(walletRows, localRows) {
  const set = new Set();
  for (const row of walletRows) {
    if (String(row.type ?? "").toUpperCase() === "MINT" && row.marketAddress) {
      set.add(normAddress(row.marketAddress));
    }
  }
  for (const row of localRows) {
    if (row.label === "买入成功" && row.market) set.add(normAddress(row.market));
  }
  return set;
}

function skippedMarketSet(localRows) {
  const set = new Set();
  for (const row of localRows) {
    if (row.label === "已跳过" && row.market) set.add(normAddress(row.market));
  }
  return set;
}

function marketState(market, { bought, skipped, pending, openWindowSeconds }) {
  const key = normAddress(market.address);
  if (bought.has(key)) return "已买";
  if (skipped.has(key)) return "已跳过";
  if (pending) return pending.prepared ? "已准备" : "待准备";
  const ageMs = Date.now() - new Date(market.startDate).getTime();
  if (!Number.isFinite(ageMs)) return "观察";
  if (ageMs < 0) return "等待";
  if (ageMs <= openWindowSeconds * 1000) return "窗口内";
  return "已错过";
}

function marketBucketFor(market, { bought, skipped, pending, openWindowSeconds }) {
  const key = normAddress(market.address);
  if (bought.has(key)) return "bought";
  if (skipped.has(key)) return "skipped";
  if (pending) return "pending";
  const ageMs = Date.now() - new Date(market.startDate).getTime();
  if (Number.isFinite(ageMs) && ageMs > openWindowSeconds * 1000) return "skipped";
  return "pending";
}

function marketMeta(category, choices) {
  return `${category || "Event Market"} · 买 ${choices} 档`;
}

function marketDurationText(market) {
  const hours = marketDurationHours(market);
  if (hours === null) return "";
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

function marketTone(market, context) {
  const state = marketState(market, context);
  if (state === "已买" || state === "已准备") return "good";
  if (state === "窗口内" || state === "待准备") return "warn";
  if (state === "已错过") return "bad";
  return "neutral";
}

function firstCategory(market) {
  return market.categories?.find((item) => item !== "Price") ?? market.tags?.[0] ?? "";
}

function normalizeHoldings(raw) {
  const rows = raw.positions ?? [];
  const groups = new Map();
  for (const row of rows) {
    const key = row.marketAddress;
    if (!groups.has(key)) {
      groups.set(key, {
        market: row.marketAddress,
        title: row.question,
        cost: 0,
        value: 0,
        pnl: 0,
        items: []
      });
    }
    const group = groups.get(key);
    group.cost += Number(row.costBasisUsdt ?? 0);
    group.value += Number(row.markValueUsdt ?? 0);
    group.pnl += Number(row.cashPnlUsdt ?? 0);
    group.items.push({
      market: row.marketAddress,
      tokenId: row.tokenId,
      title: row.question,
      outcome: row.outcome,
      buyPrice: price(row.avgPrice),
      nowPrice: price(row.curPrice),
      cost: money(row.costBasisUsdt),
      value: money(row.markValueUsdt),
      pnl: money(row.cashPnlUsdt, { sign: true }),
      pnlPct: pct(row.percentPnl),
      positive: Number(row.cashPnlUsdt ?? 0) >= 0,
      sellable: !row.isFinalized
    });
  }
  return {
    count: rows.length,
    totals: {
      cost: money(raw.totals?.costBasisUsdt),
      value: money(raw.totals?.markValueUsdt),
      pnl: money(raw.totals?.cashPnlUsdt, { sign: true }),
      positive: Number(raw.totals?.cashPnlUsdt ?? 0) >= 0
    },
    groups: [...groups.values()].map((group) => ({
      ...group,
      positionCount: group.items.length,
      cost: money(group.cost),
      value: money(group.value),
      pnl: money(group.pnl, { sign: true }),
      pnlPct: pct(group.cost > 0 ? (group.pnl / group.cost) * 100 : 0),
      sellable: group.items.some((item) => item.sellable),
      positive: group.pnl >= 0
    }))
  };
}

function buildAnalytics(rawPositions, activityRows) {
  const positions = rawPositions.positions ?? [];
  const projects = new Map();
  const totals = {
    bought: 0,
    sold: 0,
    realized: 0,
    openCost: 0,
    openValue: 0,
    openPnl: 0
  };

  for (const row of positions) {
    const project = getProject(projects, row.marketAddress, row.question);
    const openCost = num(row.costBasisUsdt);
    const openValue = num(row.markValueUsdt);
    const openPnl = num(row.cashPnlUsdt);
    project.openCost += openCost;
    project.openValue += openValue;
    project.openPnl += openPnl;
    totals.openCost += openCost;
    totals.openValue += openValue;
    totals.openPnl += openPnl;
  }

  for (const row of activityRows) {
    const type = String(row.type ?? "").toUpperCase();
    if (type !== "MINT" && type !== "REDEEM") continue;
    const project = getProject(projects, row.marketAddress, row.title);
    const collateral = num(row.collateral);
    const realized = num(row.realizedPnlDelta);
    if (type === "MINT") {
      project.bought += collateral;
      totals.bought += collateral;
    } else {
      project.sold += collateral;
      project.realized += realized;
      totals.sold += collateral;
      totals.realized += realized;
    }
  }

  const totalPnl = totals.realized + totals.openPnl;
  const totalCost = estimatedTotalCost(totals.sold, totals.realized, totals.openCost, totals.bought);
  const cards = {
    openCost: money(totals.openCost),
    openValue: money(totals.openValue),
    openPnl: money(totals.openPnl, { sign: true }),
    openPositive: totals.openPnl >= 0,
    totalBought: money(totals.bought),
    totalSold: money(totals.sold),
    realizedPnl: money(totals.realized, { sign: true }),
    totalPnl: money(totalPnl, { sign: true }),
    totalPositive: totalPnl >= 0,
    totalRoi: pct(totalCost > 0 ? (totalPnl / totalCost) * 100 : 0)
  };

  return {
    cards,
    projects: [...projects.values()]
      .map((project) => normalizeProject(project))
      .sort((a, b) => Math.abs(b.pnlValue) - Math.abs(a.pnlValue))
      .slice(0, 12)
  };
}

function getProject(projects, key, title) {
  const projectKey = key || title || "unknown";
  if (!projects.has(projectKey)) {
    projects.set(projectKey, {
      title: title || "未命名项目",
      bought: 0,
      sold: 0,
      realized: 0,
      openCost: 0,
      openValue: 0,
      openPnl: 0
    });
  }
  const project = projects.get(projectKey);
  if (!project.title && title) project.title = title;
  return project;
}

function normalizeProject(project) {
  const pnl = project.realized + project.openPnl;
  const totalCost = estimatedTotalCost(project.sold, project.realized, project.openCost, project.bought);
  return {
    title: project.title,
    bought: money(project.bought),
    sold: money(project.sold),
    openCost: money(project.openCost),
    openValue: money(project.openValue),
    pnl: money(pnl, { sign: true }),
    pnlValue: pnl,
    positive: pnl >= 0,
    roi: pct(totalCost > 0 ? (pnl / totalCost) * 100 : 0)
  };
}

function estimatedTotalCost(sold, realized, openCost, bought) {
  const closedCost = Math.max(0, sold - realized);
  const basis = closedCost + openCost;
  return basis > 0 ? basis : bought;
}

function normalizeSellQuote(result) {
  const item = result.positions?.[0];
  const quote = item?.quote ?? {};
  const positionCount = Number(result.selectedCount ?? result.positions?.length ?? 0);
  const isMarketSell = positionCount > 1;
  return {
    title: item?.question ?? "持仓",
    outcome: isMarketSell ? `全部 ${positionCount} 个仓位` : item?.outcome ?? "",
    positionCount,
    balanceOt: isMarketSell ? "" : money(quote.balanceOt),
    sellAmountOt: isMarketSell ? "" : money(quote.sellAmountOt),
    percent: quote.percent ?? null,
    expected: money(result.totals?.expectedCollateralToUserUsdt),
    minimum: money(result.totals?.minCollateralOutUsdt),
    fee: money(result.totals?.collateralToIntegratorUsdt),
    needsApproval: Number(result.totals?.positionsNeedingOperatorApproval ?? 0) > 0
  };
}

function normalizeSellExecution(result) {
  const item = result.positions?.[0];
  const executions = result.executions ?? [];
  const summary = sellExecutionsSummary(executions);
  const positionCount = Number(result.selectedCount ?? result.positions?.length ?? executions.length ?? 0);
  return {
    status: sellExecutionStatusText(summary),
    title: item?.question ?? "持仓",
    outcome: positionCount > 1 ? `全部 ${positionCount} 个仓位` : item?.outcome ?? "",
    positionCount,
    receivedText: money(result.totals?.expectedCollateralToUserUsdt),
    txHash: summary.txHashes[0] ?? "",
    txHashes: summary.txHashes,
    rawStatus: summary.rawStatus,
    waitedForReceipt: summary.waitedForReceipt,
    receiptError: summary.receiptError,
    confirmedCount: summary.confirmedCount,
    broadcastCount: summary.broadcastCount,
    failedCount: summary.failedCount,
    executionCount: summary.executionCount
  };
}

function sellExecutionsSummary(executions) {
  const rows = executions.filter(Boolean);
  const executionCount = rows.length;
  const confirmedCount = rows.filter((row) => row.status === "success").length;
  const failedCount = rows.filter((row) => row.status === "reverted").length;
  const txHashes = rows.map((row) => row.txHash).filter(Boolean);
  const broadcastCount = rows.filter((row) => row.status === "broadcast" || (row.txHash && row.status !== "reverted")).length;
  const receiptError = rows.find((row) => row.receiptError)?.receiptError ?? "";
  let rawStatus = "processed";
  if (executionCount > 0 && failedCount === executionCount) rawStatus = "reverted";
  else if (failedCount > 0) rawStatus = "partial_failed";
  else if (executionCount > 0 && confirmedCount === executionCount) rawStatus = "success";
  else if (txHashes.length > 0) rawStatus = "broadcast";
  return {
    executionCount,
    confirmedCount,
    broadcastCount,
    failedCount,
    txHashes,
    rawStatus,
    waitedForReceipt: rows.some((row) => row.waitedForReceipt),
    receiptError
  };
}

function sellExecutionStatusText(summary) {
  if (summary.rawStatus === "success") return summary.executionCount > 1 ? `已确认 ${summary.confirmedCount}/${summary.executionCount}` : "已确认";
  if (summary.rawStatus === "broadcast") return summary.executionCount > 1 ? `已广播 ${summary.broadcastCount}/${summary.executionCount}，等待确认` : "已广播，等待确认";
  if (summary.rawStatus === "partial_failed") return `部分失败 ${summary.failedCount}/${summary.executionCount}`;
  if (summary.rawStatus === "reverted") return "链上失败";
  return "已处理";
}

function normalizeApproval(result) {
  const approval = result.result ?? result;
  return {
    address: approval.address ?? "",
    router: approval.router ?? "",
    currentAllowance: money(approval.currentAllowance),
    targetAllowance: money(approval.targetAllowance ?? approval.requiredAllowance ?? approval.allowance),
    allowance: money(approval.allowance ?? approval.targetAllowance ?? approval.requiredAllowance),
    alreadyReady: Boolean(approval.alreadyReady),
    approved: Boolean(approval.approved),
    resetHash: approval.resetHash ?? "",
    approveHash: approval.approveHash ?? ""
  };
}

function normalizeActivity(rows, walletRows = []) {
  const chainRows = normalizeWalletActivity(walletRows);
  const localRows = rows.map((row) => ({
    source: "local",
    time: row.at,
    label: row.label,
    title: row.title,
    amount: activityAmount(row.amount)
  }));
  const deduped = [];
  for (const row of [...chainRows, ...localRows]
    .filter((row) => row.time && row.title)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())) {
    const index = deduped.findIndex((existing) => isSameActivity(existing, row));
    if (index >= 0) {
      if (row.source === "chain" && deduped[index].source !== "chain") deduped[index] = row;
      continue;
    }
    deduped.push(row);
  }
  return deduped.slice(0, 24).map(({ source, ...row }) => row);
}

function normalizeWalletActivity(rows) {
  const groupedBuys = new Map();
  const normalized = [];
  for (const row of rows) {
    const type = String(row.type ?? "").toUpperCase();
    const time = row.timestamp ? new Date(Number(row.timestamp) * 1000).toISOString() : null;
    if (!time) continue;
    if (type === "MINT") {
      const key = row.transactionHash || `${row.title}:${row.timestamp}`;
      const group = groupedBuys.get(key) ?? {
        source: "chain",
        time,
        label: "买入已确认",
        title: row.title,
        amountValue: 0
      };
      group.amountValue += num(row.collateral);
      groupedBuys.set(key, group);
      continue;
    }
    if (type === "REDEEM") {
      normalized.push({
        source: "chain",
        time,
        label: "卖出已确认",
        title: [row.title, row.outcome].filter(Boolean).join(" / "),
        amount: row.collateral ? `${money(row.collateral)} U` : ""
      });
    }
  }
  for (const group of groupedBuys.values()) {
    normalized.push({
      source: "chain",
      time: group.time,
      label: group.label,
      title: group.title,
      amount: `${money(group.amountValue)} U`
    });
  }
  return normalized;
}

function isSameActivity(a, b) {
  const deltaMs = Math.abs(new Date(a.time).getTime() - new Date(b.time).getTime());
  return activityLabel(a.label) === activityLabel(b.label) && a.title === b.title && deltaMs < 60000;
}

function activityLabel(label) {
  if (String(label).startsWith("买入")) return "买入";
  if (String(label).startsWith("卖出")) return "卖出";
  return label;
}

function buyActivityStatus(result) {
  if (result?.status === "success") return "买入已确认";
  if (result?.status === "broadcast" && result?.txHash) return "买入已广播";
  if (result?.status === "reverted") return "买入链上失败";
  if (result?.txHash) return "买入已广播";
  return "买入待确认";
}

function actionActivityStatus(row) {
  if (row.type === "sell") {
    if (row.rawStatus === "success" || row.status === "已确认") return "卖出已确认";
    if (row.rawStatus === "partial_failed") return "卖出部分失败";
    if (row.rawStatus === "broadcast" || row.txHash) return "卖出已广播";
    if (row.rawStatus === "reverted") return "卖出链上失败";
    return "卖出";
  }
  if (row.type === "approve") return "授权";
  return "操作";
}

function activityAmount(value) {
  if (value === undefined || value === null || value === "") return "";
  const text = String(value);
  if (/\bU\b/.test(text)) return text;
  return /^-?\d+(?:\.\d+)?$/.test(text) ? `${text} U` : text;
}

function readRecentActivity() {
  const rows = [];
  for (const row of readJsonl(fillsFile, 120)) {
    if (row.level === "event-skip-open-window") {
      rows.push({ at: row.at, label: "已跳过", title: row.question, market: row.market, amount: "" });
      continue;
    }
    if (row.level === "event-execution-error") {
      rows.push({ at: row.at, label: "买入失败", title: row.question, market: row.market, amount: "" });
      continue;
    }
    if (row.level === "event-receipt") {
      rows.push({
        at: row.at,
        label: row.status === "success" ? "买入已确认" : "买入链上失败",
        title: row.context?.question ?? "交易",
        market: row.context?.market,
        amount: ""
      });
      continue;
    }
    if (row.plan && row.result && !row.result.dryRun) {
      rows.push({
        at: row.at,
        label: buyActivityStatus(row.result),
        title: row.plan.market?.question,
        market: row.plan.market?.address,
        amount: row.plan.totalStakeUsdt ? `${money(row.plan.totalStakeUsdt)} U` : ""
      });
    }
  }
  for (const row of readJsonl(actionsFile, 80)) {
    rows.push({
      at: row.at,
      label: actionActivityStatus(row),
      title: [row.question, row.outcome].filter(Boolean).join(" / "),
      amount: row.amount
    });
  }
  return rows
    .filter((row) => row.at && row.title)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

async function getBotState() {
  if (process.platform === "win32") {
    return getWindowsBotState();
  }

  if (process.platform !== "darwin") {
    return getSystemdBotState();
  }

  try {
    const uid = String(process.getuid?.() ?? 501);
    const { stdout } = await execFileAsync("launchctl", ["print", `gui/${uid}/${launchLabel}`], { timeoutMs: 5000 });
    const state = stdout.match(/state = ([^\n]+)/)?.[1]?.trim() ?? "";
    return {
      running: state === "running",
      message: state === "running" ? "运行中" : "未运行"
    };
  } catch {
    return { running: false, message: "未运行" };
  }
}

async function getWindowsBotState() {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'src[\\\\/]event-sniper\\.js (arm|watch)' } | Select-Object -First 1 -ExpandProperty CommandLine"
    ], { timeoutMs: 5000 });
    const command = stdout.trim();
    return {
      running: Boolean(command),
      message: command ? "event watcher is running" : "event watcher is not running"
    };
  } catch {
    return { running: false, message: "event watcher status check failed" };
  }
}

async function getSystemdBotState() {
  try {
    const { stdout } = await execFileAsync("systemctl", [
      "show",
      systemdService,
      "--property=ActiveState,SubState,MainPID,ExecMainStartTimestamp"
    ], { timeoutMs: 5000 });
    const props = parseSystemctlShow(stdout);
    const activeState = props.ActiveState ?? "";
    const subState = props.SubState ?? "";
    const running = activeState === "active" && subState === "running";
    return {
      running,
      pid: Number(props.MainPID) || null,
      startedAt: props.ExecMainStartTimestamp || null,
      message: running ? "运行中" : "未运行"
    };
  } catch {
    return { running: false, message: "未运行" };
  }
}

function parseSystemctlShow(text) {
  const props = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    props[line.slice(0, index)] = line.slice(index + 1);
  }
  return props;
}

async function getBuySpeedStats(cfg) {
  const now = Date.now();
  if (buySpeedCache && now - buySpeedCache.at < 60000) return buySpeedCache.data;
  if (buySpeedPromise) return buySpeedPromise;
  buySpeedPromise = buildBuySpeedStats(cfg)
    .then((data) => {
      buySpeedCache = { at: Date.now(), data };
      return data;
    })
    .catch((error) => ({
      ok: false,
      updatedAt: new Date().toISOString(),
      items: [],
      message: cleanError(error)
    }))
    .finally(() => {
      buySpeedPromise = null;
    });
  return buySpeedPromise;
}

async function buildBuySpeedStats(cfg) {
  const recent = recentBuyExecutions(6);
  const blockCache = new Map();
  const items = [];
  for (const item of recent) {
    try {
      items.push(await computeBuySpeedStat(cfg, item, blockCache));
    } catch (error) {
      items.push({
        ...item,
        ok: false,
        message: cleanError(error)
      });
    }
  }
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    items
  };
}

function recentBuyExecutions(limit) {
  const rows = readJsonl(fillsFile, 400).reverse();
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    const result = row.result;
    if (!result?.txHash || result.dryRun) continue;
    if (row.plan?.market?.address) {
      const item = buySpeedItemFromPlan(row, row.plan, result);
      pushUniqueBuySpeedItem(items, seen, item);
    }
    if (row.bundle?.markets?.length) {
      for (const market of row.bundle.markets) {
        const item = buySpeedItemFromBundleMarket(row, market, result);
        pushUniqueBuySpeedItem(items, seen, item);
      }
    }
    if (items.length >= limit) break;
  }
  return items.slice(0, limit);
}

function pushUniqueBuySpeedItem(items, seen, item) {
  if (!item?.market || !item.txHash) return;
  const key = `${normAddress(item.market)}:${String(item.txHash).toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

function buySpeedItemFromPlan(row, plan, result) {
  return {
    title: plan.market?.question ?? "Market",
    market: plan.market?.address,
    startDate: plan.market?.startDate ?? null,
    at: row.at,
    txHash: result.txHash,
    stake: plan.totalStakeUsdt ? `${money(plan.totalStakeUsdt)} U` : "",
    outcomes: plan.selectedOutcomeCount ?? plan.outcomes?.length ?? null,
    status: result.status ?? null
  };
}

function buySpeedItemFromBundleMarket(row, market, result) {
  return {
    title: market.question ?? "Market",
    market: market.address,
    startDate: market.startDate ?? null,
    at: row.at,
    txHash: result.txHash,
    stake: market.totalStakeUsdt ? `${money(market.totalStakeUsdt)} U` : "",
    outcomes: market.outcomeCount ?? null,
    status: result.status ?? null
  };
}

async function computeBuySpeedStat(cfg, item, blockCache) {
  const [receipt, tx] = await Promise.all([
    rpcCall(cfg, "eth_getTransactionReceipt", [item.txHash]),
    rpcCall(cfg, "eth_getTransactionByHash", [item.txHash])
  ]);
  if (!receipt) throw new Error("receipt not found");
  const receiptBlock = hexNumber(receipt.blockNumber);
  const receiptIndex = hexNumber(receipt.transactionIndex);
  const receiptBlockData = await getRpcBlock(cfg, receiptBlock, blockCache);
  const startTs = Math.floor(Date.parse(item.startDate ?? "") / 1000);
  let fromBlock = Math.max(1, receiptBlock - 1000);
  let truncated = false;
  if (Number.isFinite(startTs)) {
    const startBlock = await firstBlockAtOrAfter(cfg, startTs, receiptBlock, blockCache);
    fromBlock = startBlock.num;
    const floor = Math.max(1, receiptBlock - 20000);
    if (fromBlock < floor) {
      fromBlock = floor;
      truncated = true;
    }
  }

  const logs = await rpcCall(cfg, "eth_getLogs", [{
    address: item.market,
    fromBlock: toHex(fromBlock),
    toBlock: receipt.blockNumber,
    topics: [marketMintTopic]
  }]);
  const groups = groupMintLogs(logs);
  const rankIndex = groups.findIndex((group) => group.hash === String(item.txHash).toLowerCase());
  const peerHashes = groups.slice(0, 5).map((group) => group.hash);
  const peerTxs = await rpcBatch(cfg, peerHashes.map((hash, id) => ({
    jsonrpc: "2.0",
    id,
    method: "eth_getTransactionByHash",
    params: [hash]
  })));
  const peers = peerHashes.map((hash, index) => {
    const group = groups[index];
    const peerTx = peerTxs.find((row) => row.id === index)?.result;
    return {
      rank: index + 1,
      txHash: shortHash(hash),
      blockNumber: group.blockNumber,
      txIndex: group.transactionIndex,
      gasGwei: formatGwei(peerTx?.gasPrice),
      outcomeEvents: group.count
    };
  });

  return {
    ...item,
    ok: true,
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    before: rankIndex >= 0 ? rankIndex : null,
    blockNumber: receiptBlock,
    txIndex: receiptIndex,
    blockTime: new Date(receiptBlockData.ts * 1000).toISOString(),
    openDeltaSec: Number.isFinite(startTs) ? receiptBlockData.ts - startTs : null,
    gasGwei: formatGwei(tx?.gasPrice ?? receipt.effectiveGasPrice),
    gasUsed: hexNumber(receipt.gasUsed),
    outcomeEvents: rankIndex >= 0 ? groups[rankIndex]?.count ?? null : null,
    peers,
    truncated
  };
}

function groupMintLogs(logs) {
  const groups = new Map();
  for (const log of logs ?? []) {
    const hash = String(log.transactionHash ?? "").toLowerCase();
    if (!hash) continue;
    if (!groups.has(hash)) {
      groups.set(hash, {
        hash,
        blockNumber: hexNumber(log.blockNumber),
        transactionIndex: hexNumber(log.transactionIndex),
        logIndex: hexNumber(log.logIndex),
        count: 0
      });
    }
    const group = groups.get(hash);
    group.count += 1;
    group.logIndex = Math.min(group.logIndex, hexNumber(log.logIndex));
  }
  return [...groups.values()].sort((a, b) =>
    a.blockNumber - b.blockNumber ||
    a.transactionIndex - b.transactionIndex ||
    a.logIndex - b.logIndex
  );
}

async function firstBlockAtOrAfter(cfg, timestamp, highBlock, blockCache) {
  let high = highBlock;
  let low = Math.max(1, highBlock - 5000);
  const highData = await getRpcBlock(cfg, high, blockCache);
  const secondsBack = Math.max(0, highData.ts - timestamp);
  low = Math.max(1, highBlock - Math.ceil(secondsBack * 4) - 1000);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await getRpcBlock(cfg, mid, blockCache);
    if (block.ts >= timestamp) high = mid;
    else low = mid + 1;
  }
  return getRpcBlock(cfg, low, blockCache);
}

async function getRpcBlock(cfg, blockNumber, blockCache) {
  if (blockCache.has(blockNumber)) return blockCache.get(blockNumber);
  const block = await rpcCall(cfg, "eth_getBlockByNumber", [toHex(blockNumber), false]);
  const parsed = {
    num: blockNumber,
    ts: hexNumber(block.timestamp)
  };
  blockCache.set(blockNumber, parsed);
  return parsed;
}

async function rpcCall(cfg, method, params) {
  const json = await rpcBatch(cfg, [{ jsonrpc: "2.0", id: 1, method, params }]);
  const row = json[0];
  if (row?.error) throw new Error(row.error.message ?? JSON.stringify(row.error));
  return row?.result ?? null;
}

async function rpcBatch(cfg, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const json = await response.json();
    return Array.isArray(json) ? json : [json];
  } finally {
    clearTimeout(timer);
  }
}

function hexNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (!value) return 0;
  return Number.parseInt(String(value), 16);
}

function toHex(value) {
  return `0x${Number(value).toString(16)}`;
}

function formatGwei(value) {
  if (!value) return "";
  const wei = typeof value === "bigint" ? value : BigInt(value);
  return `${trimNumber(Number(wei) / 1e9, 6)} gwei`;
}

function trimNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(digits)));
}

async function fetchUserActivity() {
  try {
    const cfg = readConfig();
    return await fetchActivity(cfg, {
      user: botWallet,
      limit: Number(process.env.DASHBOARD_ACTIVITY_LIMIT ?? 500)
    });
  } catch {
    return [];
  }
}

async function fetchNewMarketsFeed() {
  try {
    const cfg = readConfig();
    const liveLimit = Number(process.env.DASHBOARD_NEW_MARKETS_LIMIT ?? 24);
    const futureLimit = Number(process.env.DASHBOARD_FUTURE_MARKETS_LIMIT ?? Math.max(cfg.watchScanLimit, 100));
    const [future, live] = await Promise.all([
      fetchMarkets(cfg, {
        status: "not_started",
        topic: "",
        order: "start_timestamp",
        ascending: true,
        limit: futureLimit
      }),
      fetchMarkets(cfg, {
        status: "live",
        topic: "",
        order: "start_timestamp",
        ascending: false,
        limit: liveLimit
      })
    ]);
    return mergeDashboardMarkets(future, live);
  } catch {
    return [];
  }
}

function mergeDashboardMarkets(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const market of list ?? []) {
      if (!market?.address) continue;
      const key = normAddress(market.address);
      if (!merged.has(key)) merged.set(key, market);
    }
  }
  return [...merged.values()];
}

async function runEvent(args, { timeoutMs = 30000, env = {} } = {}) {
  const script = path.join(rootDir, "src/event-sniper.js");
  const { stdout } = await execFileAsync(process.execPath, [script, ...args], {
    cwd: rootDir,
    timeoutMs,
    env: { ...process.env, ...env }
  });
  const parsed = parseLastJson(stdout);
  if (!parsed) throw new Error("No data returned");
  return parsed;
}

function execFileAsync(command, args, { timeoutMs = 30000, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { ...options, maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (error) {
        error.message = cleanError(`${error.message}\n${stderr || stdout}`);
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Request timed out"));
    }, timeoutMs);
  });
}

function parseLastJson(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const raw = text.slice(start, i + 1);
        try {
          objects.push(JSON.parse(raw));
        } catch {
          // Ignore non-JSON log fragments.
        }
        start = -1;
      }
    }
  }
  return objects.at(-1) ?? null;
}

function readJsonl(file, limit) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readTextBody(req, maxBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleLogin(req, res) {
  if (!authEnabled()) return redirect(res, "/");
  if (isLoginRateLimited(req)) return redirect(res, dashboardAuthFailRedirect);

  const text = await readTextBody(req);
  const contentType = req.headers["content-type"] ?? "";
  const password = contentType.includes("application/json")
    ? JSON.parse(text || "{}")?.password
    : new URLSearchParams(text).get("password");

  if (!sameSecret(password ?? "", dashboardPassword)) {
    recordLoginFailure(req);
    return redirect(res, dashboardAuthFailRedirect);
  }

  loginFailures.delete(clientKey(req));
  setAuthCookie(req, res);
  return redirect(res, "/");
}

function authEnabled() {
  return Boolean(dashboardPassword);
}

function isAuthenticated(req) {
  if (!authEnabled()) return true;
  const token = parseCookies(req.headers.cookie ?? "")[dashboardAuthCookie];
  if (!token) return false;
  const [issuedText, signature] = token.split(".");
  const issued = Number(issuedText);
  if (!Number.isFinite(issued) || !signature) return false;
  if (Date.now() - issued > dashboardAuthMaxAgeSeconds * 1000) return false;
  return sameSecret(signature, authSignature(issuedText));
}

function rejectUnauthenticated(req, res, url) {
  if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
    return serveLogin(res, 401);
  }
  return sendJson(res, { ok: false, message: "Authentication required" }, 401);
}

function serveLogin(res, status = 200) {
  if (!authEnabled()) return redirect(res, "/");
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>42 Dashboard</title>
    <link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
    <meta name="theme-color" content="#120c18">
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; color: #f7f1fb; background: #120c18; }
      form { width: min(360px, calc(100vw - 40px)); display: grid; gap: 14px; padding: 28px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: #1b1223; }
      h1 { margin: 0; font-size: 20px; }
      input, button { height: 42px; border-radius: 8px; font-size: 15px; }
      input { border: 1px solid rgba(255,255,255,.18); padding: 0 12px; color: #fff; background: #0f0a14; }
      button { border: 0; color: #150f1c; background: #7ee0b2; font-weight: 700; cursor: pointer; }
    </style>
  </head>
  <body>
    <form method="post" action="/login" autocomplete="off">
      <h1>42 Dashboard</h1>
      <input name="password" type="password" placeholder="Password" autofocus required>
      <button type="submit">Enter</button>
    </form>
  </body>
</html>`);
}

function setAuthCookie(req, res) {
  const issued = String(Date.now());
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.setHeader("set-cookie", `${dashboardAuthCookie}=${issued}.${authSignature(issued)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${dashboardAuthMaxAgeSeconds}${secure}`);
}

function clearAuthCookie(req, res) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.setHeader("set-cookie", `${dashboardAuthCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function authSignature(value) {
  return crypto.createHmac("sha256", dashboardAuthSecret).update(value).digest("base64url");
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) continue;
    cookies[name] = rest.join("=");
  }
  return cookies;
}

function isSecureRequest(req) {
  return process.env.DASHBOARD_COOKIE_SECURE === "1" || req.headers["x-forwarded-proto"] === "https";
}

function isLoginRateLimited(req) {
  const row = loginFailures.get(clientKey(req));
  if (!row) return false;
  if (Date.now() - row.firstAt > 300000) {
    loginFailures.delete(clientKey(req));
    return false;
  }
  return row.count >= 8;
}

function recordLoginFailure(req) {
  const key = clientKey(req);
  const current = loginFailures.get(key);
  if (!current || Date.now() - current.firstAt > 300000) {
    loginFailures.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  current.count += 1;
}

function clientKey(req) {
  return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { location, "cache-control": "no-store" });
  res.end();
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(value));
}

function serveStatic(res, pathname) {
  const safe = path.normalize(pathname.replace(/^\/assets\//, ""));
  if (safe.startsWith("..")) return sendJson(res, { ok: false }, 404);
  const file = path.join(publicDir, "assets", safe);
  const ext = path.extname(file);
  const type = ext === ".css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
  return serveFile(res, file, type);
}

function serveFile(res, file, type) {
  if (!fs.existsSync(file)) return sendJson(res, { ok: false }, 404);
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store"
  });
  res.end(fs.readFileSync(file));
}

function money(value, { sign = false } = {}) {
  const num = Number(value ?? 0);
  const prefix = sign && num > 0 ? "+" : "";
  const raw = num.toFixed(Math.abs(num) >= 10 ? 2 : 4).replace(/\.?0+$/, "");
  const clean = raw === "-0" ? "0" : raw;
  return `${prefix}${clean}`;
}

function price(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) return "--";
  if (num < 0.01) return num.toFixed(4);
  if (num < 1) return num.toFixed(3).replace(/\.?0+$/, "");
  return num.toFixed(2).replace(/\.?0+$/, "");
}

function pct(value) {
  const num = Number(value ?? 0);
  const prefix = num > 0 ? "+" : "";
  return `${prefix}${num.toFixed(1)}%`;
}

function num(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normAddress(value) {
  return String(value ?? "").toLowerCase();
}

function cleanError(error) {
  return String(error?.message ?? error)
    .replace(/(?:https?|wss?):\/\/[^\s")]+/g, "[RPC]")
    .split("\n")
    .filter((line) => line.trim())
    .at(0) ?? "Error";
}
