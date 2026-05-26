#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { fetchActivity, fetchMarkets } from "./fortytwo.js";
import { isEventMarket, isPriceMarket } from "./event-strategy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const botWallet = process.env.DASHBOARD_WALLET ?? "0x244FcE72db40B69C4DA4D41F0a76E25B24CA201b";
const host = process.env.DASHBOARD_HOST ?? "127.0.0.1";
const port = Number(process.env.DASHBOARD_PORT ?? 4242);
const launchLabel = "com.myandong.42space-event-arm";
const fillsFile = path.join(rootDir, "data/fills.jsonl");
const actionsFile = path.join(rootDir, "data/dashboard-actions.jsonl");

let overviewCache = null;
let overviewPromise = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveFile(res, path.join(publicDir, "dashboard.html"), "text/html; charset=utf-8");
    }
    if (url.pathname.startsWith("/assets/")) {
      return serveStatic(res, url.pathname);
    }
    if (url.pathname === "/api/overview" && req.method === "GET") {
      return sendJson(res, await getOverview());
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
  const [status, positions, walletActivity, newMarkets, bot] = await Promise.all([
    runEvent(["status", "--wallet", botWallet], { timeoutMs: 30000 }),
    runEvent(["positions", "--wallet", botWallet], { timeoutMs: 30000 }),
    fetchUserActivity(),
    fetchNewMarketsFeed(),
    getBotState()
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
    settings: {
      stakeText: `${status.watchConfig?.eventOutcomeCount ?? cfg.eventOutcomeCount ?? 5} 档 / ${status.watchConfig?.stakePerOutcomeUsdt ?? cfg.stakePerOutcomeUsdt ?? 5}U`,
      windowText: `${status.watchConfig?.eventOpenWindowSeconds ?? 60}s`,
      autoSellText: autoSellText(status.watchConfig, cfg)
    }
  };
}

function autoSellText(watchConfig, cfg) {
  const enabled = Boolean(watchConfig?.autoSellEnabled ?? cfg.autoSellEnabled);
  if (!enabled) return "关闭";
  return `${watchConfig?.autoSellProfitMultiplier ?? cfg.autoSellProfitMultiplier}x / 卖 ${watchConfig?.autoSellPercent ?? cfg.autoSellPercent}%`;
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
    status: summary.status
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
  const waitingFunds = status.wallet && (!status.wallet.balanceReady || !status.wallet.bnbReady);
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
    bnb: Number(wallet.bnbBalance ?? 0).toFixed(6),
    ready: Boolean(wallet.balanceReady && wallet.bnbReady),
    message: fundingMessage(wallet)
  };
}

function fundingMessage(wallet) {
  if (!wallet) return "";
  if (wallet.balanceReady && wallet.bnbReady) return "资金够";
  const missing = Math.max(0, Number(wallet.requiredBusdt ?? 0) - Number(wallet.busdtBalance ?? 0));
  if (missing > 0) return `差 ${money(missing)} U`;
  return "需要补 BNB";
}

function normalizeNext(status) {
  const markets = status.future ?? [];
  const next = markets[0] ?? null;
  return {
    count: markets.length,
    items: markets.slice(0, 6).map((market) => ({
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
    if (isPriceMarket(market, cfg)) {
      excluded += 1;
      continue;
    }
    if (!isEventMarket(market, cfg)) continue;
    const key = normAddress(market.address);
    const pending = future.get(key);
    rows.push({
      title: market.question,
      category: firstCategory(market),
      startsAt: market.startDate,
      choices: Math.min(Number(status.watchConfig?.eventOutcomeCount ?? cfg.eventOutcomeCount ?? 5), market.outcomes?.length ?? 0),
      stake: money(Number(status.watchConfig?.stakePerOutcomeUsdt ?? cfg.stakePerOutcomeUsdt ?? 5) *
        Math.min(Number(status.watchConfig?.eventOutcomeCount ?? cfg.eventOutcomeCount ?? 5), market.outcomes?.length ?? 0)),
      state: marketState(market, { bought, skipped, pending, openWindowSeconds }),
      tone: marketTone(market, { bought, skipped, pending, openWindowSeconds })
    });
  }

  return {
    count: rows.length,
    excluded,
    items: rows.slice(0, 8)
  };
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
      cost: money(group.cost),
      value: money(group.value),
      pnl: money(group.pnl, { sign: true }),
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
  return {
    title: item?.question ?? "持仓",
    outcome: item?.outcome ?? "",
    balanceOt: money(quote.balanceOt),
    sellAmountOt: money(quote.sellAmountOt),
    percent: quote.percent ?? null,
    expected: money(result.totals?.expectedCollateralToUserUsdt),
    minimum: money(result.totals?.minCollateralOutUsdt),
    fee: money(result.totals?.collateralToIntegratorUsdt),
    needsApproval: Number(result.totals?.positionsNeedingOperatorApproval ?? 0) > 0
  };
}

function normalizeSellExecution(result) {
  const item = result.positions?.[0];
  const execution = result.executions?.[0] ?? {};
  return {
    status: execution.status === "success" || execution.txHash ? "已提交" : "已处理",
    title: item?.question ?? "持仓",
    outcome: item?.outcome ?? "",
    receivedText: money(result.totals?.expectedCollateralToUserUsdt)
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
        label: "买入",
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
        label: "卖出",
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
  return label === "买入成功" ? "买入" : label;
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
        label: row.status === "success" ? "买入成功" : "未成交",
        title: row.context?.question ?? "交易",
        market: row.context?.market,
        amount: ""
      });
      continue;
    }
    if (row.plan && row.result && !row.result.dryRun) {
      rows.push({
        at: row.at,
        label: row.result.status === "success" ? "买入成功" : "等待确认",
        title: row.plan.market?.question,
        market: row.plan.market?.address,
        amount: row.plan.totalStakeUsdt ? `${money(row.plan.totalStakeUsdt)} U` : ""
      });
    }
  }
  for (const row of readJsonl(actionsFile, 80)) {
    rows.push({
      at: row.at,
      label: row.type === "sell" ? "卖出" : "操作",
      title: [row.question, row.outcome].filter(Boolean).join(" / "),
      amount: row.amount
    });
  }
  return rows
    .filter((row) => row.at && row.title)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

async function getBotState() {
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
    return await fetchMarkets(cfg, {
      status: "live",
      topic: "",
      order: "start_timestamp",
      ascending: false,
      limit: Number(process.env.DASHBOARD_NEW_MARKETS_LIMIT ?? 24)
    });
  } catch {
    return [];
  }
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
