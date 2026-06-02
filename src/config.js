import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function loadDotEnv(file = ".env") {
  loadDotEnvFile(file, { override: false });
}

export function loadDotEnvFile(file = ".env", { override = false } = {}) {
  if (!file) return;
  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || process.env[key] === undefined) process.env[key] = value;
  }
}

export function readConfig() {
  loadDotEnv(".env.local");
  loadDotEnv();
  loadProviderEnv();
  loadBotConfigEnv();

  const cfg = {
    restUrl: envString("FORTYTWO_REST_URL", "https://rest.ft.42.space"),
    rpcUrl: envFirst(
      ["BSC_RPC_URL", "CHAINSTACK_BSC_RPC_URL", "ANKR_BSC_RPC_URL"],
      "https://bsc-rpc.publicnode.com"
    ),
    wsUrl: envFirst(
      ["BSC_WS_URL", "CHAINSTACK_BSC_WS_URL", "ANKR_BSC_WS_URL", "ANKR_BSC_WS_RPC_URL"],
      "wss://bsc-rpc.publicnode.com"
    ),
    privateKey: envString("PRIVATE_KEY", "") || readKeychainPrivateKey() || readWindowsDpapiPrivateKey(),
    walletAddress: envString("WALLET_ADDRESS", ""),
    dryRun: envBool("DRY_RUN", true),
    execute: envBool("EXECUTE", false),
    riskAck: envString("I_UNDERSTAND_42_PRICE_MARKET_RISK", "NO"),
    eligibilityAck: envString("I_AM_NOT_IN_RESTRICTED_JURISDICTION", "NO"),
    targetTopic: envOptionalString("TARGET_TOPIC", "BTC"),
    targetQuestionRegex: envRegex("TARGET_QUESTION_REGEX", "BTC.*(Futures Daily Volume|Price|USDT)"),
    targetOutcomeRegex: envRegex("TARGET_OUTCOME_REGEX", ""),
    strategy: envString("STRATEGY", "binance_volume_projection"),
    stakeUsdt: envNumber("STAKE_USDT", 5),
    stakePerOutcomeUsdt: envNumber("STAKE_PER_OUTCOME_USDT", 5),
    maxStakeUsdt: envNumber("MAX_STAKE_USDT", 25),
    maxMarketStakeUsdt: envNumber("MAX_MARKET_STAKE_USDT", 25),
    maxBatchStakeUsdt: envNumber("MAX_BATCH_STAKE_USDT", 100),
    eventOutcomeSelection: envString("EVENT_OUTCOME_SELECTION", "lowest_odds"),
    eventOutcomeCount: envInteger("EVENT_OUTCOME_COUNT", 5),
    eventOutcomeSelectionFallback: envString("EVENT_OUTCOME_SELECTION_FALLBACK", "error"),
    eventBuyMode: envString("EVENT_BUY_MODE", "fast"),
    eventDiscovery: envString("EVENT_DISCOVERY", "ws"),
    restDiscoveryEnabled: envBool("REST_DISCOVERY_ENABLED", true),
    restDiscoveryPollMs: envInteger("REST_DISCOVERY_POLL_MS", 1000),
    watchFundingMode: envString("WATCH_FUNDING_MODE", "next_batch"),
    bundleDueMarkets: envBool("BUNDLE_DUE_MARKETS", true),
    fastSkipPreflight: envBool("FAST_SKIP_PREFLIGHT", true),
    fastSkipDueRestHydration: envBool("FAST_SKIP_DUE_REST_HYDRATION", true),
    fastNonceManager: envBool("FAST_NONCE_MANAGER", true),
    preSignFastTx: envBool("PRE_SIGN_FAST_TX", true),
    preSignWindowMs: envInteger("PRE_SIGN_WINDOW_MS", 5000),
    preSignRetryMs: envInteger("PRE_SIGN_RETRY_MS", 250),
    nonceSyncBeforePreSign: envBool("NONCE_SYNC_BEFORE_PRESIGN", true),
    nonceSyncMinIntervalMs: envInteger("NONCE_SYNC_MIN_INTERVAL_MS", 250),
    waitForReceipt: envBool("WAIT_FOR_RECEIPT", true),
    asyncReceiptWatch: envBool("ASYNC_RECEIPT_WATCH", true),
    receiptWatchTimeoutMs: envInteger("RECEIPT_WATCH_TIMEOUT_MS", 120000),
    receiptWatchPollingMs: envInteger("RECEIPT_WATCH_POLLING_MS", 1000),
    executionRetryMs: envInteger("EXECUTION_RETRY_MS", 500),
    eventOpenWindowSeconds: envInteger("EVENT_OPEN_WINDOW_SECONDS", 25),
    eventBuyDelaySeconds: envInteger("EVENT_BUY_DELAY_SECONDS", 0),
    requireRestBeforeBuy: envBool("REQUIRE_REST_BEFORE_BUY", false),
    requireRestStatus: envList("REQUIRE_REST_STATUS", ""),
    requireQuoteBeforeBuy: envBool("REQUIRE_QUOTE_BEFORE_BUY", false),
    requireChainMintBeforeBuy: envBool("REQUIRE_CHAIN_MINT_BEFORE_BUY", false),
    fanoutBroadcast: envBool("FANOUT_BROADCAST", true),
    broadcastRpcUrls: [],
    broadcastTimeoutMs: envInteger("BROADCAST_TIMEOUT_MS", 1200),
    rpcWarmupTimeoutMs: envInteger("RPC_WARMUP_TIMEOUT_MS", 2500),
    doctorCheckWs: envBool("DOCTOR_CHECK_WS", false),
    gasPriceGwei: envString("GAS_PRICE_GWEI", "0.12"),
    sellGasPriceGwei: envString("SELL_GAS_PRICE_GWEI", envString("GAS_PRICE_GWEI", "0.12")),
    operatorApproveGasPriceGwei: envString("OPERATOR_APPROVE_GAS_PRICE_GWEI", envString("GAS_PRICE_GWEI", "0.12")),
    fastGasLimit: envInteger("FAST_GAS_LIMIT", 5000000),
    fastSellGasLimit: envInteger("FAST_SELL_GAS_LIMIT", 1000000),
    bundleFastGasLimit: envInteger("BUNDLE_FAST_GAS_LIMIT", 12000000),
    logChunkBlocks: envInteger("LOG_CHUNK_BLOCKS", 5000),
    watchScanLimit: envInteger("WATCH_SCAN_LIMIT", 500),
    eventLogLookbackBlocks: envInteger("EVENT_LOG_LOOKBACK_BLOCKS", 50000),
    replayLookbackBlocks: envInteger("REPLAY_LOOKBACK_BLOCKS", 50000),
    marketCategoryAllowlist: envList("MARKET_CATEGORY_ALLOWLIST", ""),
    marketCategoryBlocklist: envList("MARKET_CATEGORY_BLOCKLIST", "Price"),
    marketTagBlocklist: envList("MARKET_TAG_BLOCKLIST", "8 hour,automated"),
    marketAddressBlocklist: envList("MARKET_ADDRESS_BLOCKLIST", ""),
    marketQuestionBlocklist: envList("MARKET_QUESTION_BLOCKLIST", ""),
    allowOnchainOnlyMarkets: envBool("ALLOW_ONCHAIN_ONLY_MARKETS", false),
    minMarketCreatedAt: envString("MIN_MARKET_CREATED_AT", ""),
    minMarketDurationHours: envNumber("MIN_MARKET_DURATION_HOURS", 48),
    watchBuyExisting: envBool("WATCH_BUY_EXISTING", false),
    slippageBps: envInteger("SLIPPAGE_BPS", 800),
    pollMs: envInteger("POLL_MS", 500),
    hotPollMs: envInteger("HOT_POLL_MS", 50),
    preopenHotMs: envInteger("PREOPEN_HOT_MS", 5000),
    prebroadcastMs: envInteger("PREBROADCAST_MS", 0),
    wsReceiptFallbackMs: envInteger("WS_RECEIPT_FALLBACK_MS", 0),
    wsReceiptFallbackRetries: envInteger("WS_RECEIPT_FALLBACK_RETRIES", 3),
    watchStartupRetryMs: envInteger("WATCH_STARTUP_RETRY_MS", 5000),
    armWaitForFunding: envBool("ARM_WAIT_FOR_FUNDING", false),
    armFundingRetryMs: envInteger("ARM_FUNDING_RETRY_MS", 60000),
    armFundingHotRetryMs: envInteger("ARM_FUNDING_HOT_RETRY_MS", 1000),
    armFundingHotWindowMs: envInteger("ARM_FUNDING_HOT_WINDOW_MS", 600000),
    armCatchUpAfterFunding: envBool("ARM_CATCH_UP_AFTER_FUNDING", false),
    armCatchUpWindowMs: envInteger("ARM_CATCH_UP_WINDOW_MS", 0),
    autoSellEnabled: envBool("AUTO_SELL_ENABLED", true),
    autoSellPollMs: envInteger("AUTO_SELL_POLL_MS", 3000),
    autoSellMinOutMode: envString("AUTO_SELL_MIN_OUT_MODE", "quote"),
    autoSellManualMinOutUsdt: envNumber("AUTO_SELL_MANUAL_MIN_OUT_USDT", 0.000001),
    autoSellOriginalEnabled: envBool("AUTO_SELL_ORIGINAL_ENABLED", true),
    autoSellProfitMultiplier: envNumber("AUTO_SELL_PROFIT_MULTIPLIER", 2),
    autoSellPercent: envNumber("AUTO_SELL_PERCENT", 50),
    autoSellFixedTrailingEnabled: envBool("AUTO_SELL_FIXED_TRAILING_ENABLED", false),
    autoSellTrailingStartDelaySeconds: envInteger("AUTO_SELL_TRAILING_START_DELAY_SECONDS", 30),
    autoSellTrailingArmProfitPct: envNumber("AUTO_SELL_TRAILING_ARM_PROFIT_PCT", 30),
    autoSellTrailingDrawdownPct: envNumber("AUTO_SELL_TRAILING_DRAWDOWN_PCT", 25),
    autoSellTrailingPercent: envNumber("AUTO_SELL_TRAILING_PERCENT", 100),
    autoSellAdaptiveTrailingEnabled: envBool("AUTO_SELL_ADAPTIVE_TRAILING_ENABLED", false),
    autoSellAdaptiveStartDelaySeconds: envInteger("AUTO_SELL_ADAPTIVE_START_DELAY_SECONDS", 30),
    autoSellAdaptiveArmProfitPct: envNumber("AUTO_SELL_ADAPTIVE_ARM_PROFIT_PCT", 30),
    autoSellAdaptiveEarlySeconds: envInteger("AUTO_SELL_ADAPTIVE_EARLY_SECONDS", 180),
    autoSellAdaptiveEarlyDrawdownPct: envNumber("AUTO_SELL_ADAPTIVE_EARLY_DRAWDOWN_PCT", 25),
    autoSellAdaptiveWindowSeconds: envInteger("AUTO_SELL_ADAPTIVE_WINDOW_SECONDS", 120),
    autoSellAdaptiveMinSamples: envInteger("AUTO_SELL_ADAPTIVE_MIN_SAMPLES", 8),
    autoSellAdaptiveSmallJumpPct: envNumber("AUTO_SELL_ADAPTIVE_SMALL_JUMP_PCT", 8),
    autoSellAdaptiveSmallRangePct: envNumber("AUTO_SELL_ADAPTIVE_SMALL_RANGE_PCT", 80),
    autoSellAdaptiveSmallDrawdownPct: envNumber("AUTO_SELL_ADAPTIVE_SMALL_DRAWDOWN_PCT", 18),
    autoSellAdaptiveNormalDrawdownPct: envNumber("AUTO_SELL_ADAPTIVE_NORMAL_DRAWDOWN_PCT", 22),
    autoSellAdaptiveLargeJumpPct: envNumber("AUTO_SELL_ADAPTIVE_LARGE_JUMP_PCT", 18),
    autoSellAdaptiveLargeRangePct: envNumber("AUTO_SELL_ADAPTIVE_LARGE_RANGE_PCT", 250),
    autoSellAdaptiveLargeDrawdownPct: envNumber("AUTO_SELL_ADAPTIVE_LARGE_DRAWDOWN_PCT", 28),
    autoSellAdaptivePercent: envNumber("AUTO_SELL_ADAPTIVE_PERCENT", 100),
    autoSellWeakExitEnabled: envBool("AUTO_SELL_WEAK_EXIT_ENABLED", false),
    autoSellWeakExitAfterOpenSeconds: envInteger("AUTO_SELL_WEAK_EXIT_AFTER_OPEN_SECONDS", 1800),
    autoSellWeakExitMinPeakProfitPct: envNumber("AUTO_SELL_WEAK_EXIT_MIN_PEAK_PROFIT_PCT", 20),
    autoSellWeakExitMaxCurrentProfitPct: envNumber("AUTO_SELL_WEAK_EXIT_MAX_CURRENT_PROFIT_PCT", 20),
    autoSellWeakExitPercent: envNumber("AUTO_SELL_WEAK_EXIT_PERCENT", 100),
    autoSellBreakevenEnabled: envBool("AUTO_SELL_BREAKEVEN_ENABLED", false),
    autoSellBreakevenStartDelaySeconds: envInteger("AUTO_SELL_BREAKEVEN_START_DELAY_SECONDS", 30),
    autoSellBreakevenArmProfitPct: envNumber("AUTO_SELL_BREAKEVEN_ARM_PROFIT_PCT", 30),
    autoSellBreakevenExitProfitPct: envNumber("AUTO_SELL_BREAKEVEN_EXIT_PROFIT_PCT", 3),
    autoSellBreakevenPercent: envNumber("AUTO_SELL_BREAKEVEN_PERCENT", 100),
    autoSellPositionLimit: envInteger("AUTO_SELL_POSITION_LIMIT", 500),
    autoSellStateFile: envString("AUTO_SELL_STATE_FILE", "data/auto-sell-seen.json"),
    autoSellPositionStateFile: envString("AUTO_SELL_POSITION_STATE_FILE", "data/auto-sell-position-state.json"),
    pushPlusEnabled: envBool("PUSHPLUS_ENABLED", Boolean(envString("PUSHPLUS_TOKEN", ""))),
    pushPlusToken: envString("PUSHPLUS_TOKEN", ""),
    pushPlusUrl: envString("PUSHPLUS_URL", "https://www.pushplus.plus/send"),
    pushPlusTemplate: envString("PUSHPLUS_TEMPLATE", "markdown"),
    notificationStateFile: envString("NOTIFICATION_STATE_FILE", "data/notified-markets.json"),
    runtimeStatusFile: envString("RUNTIME_STATUS_FILE", "data/runtime-status.json"),
    scanLimit: envInteger("SCAN_LIMIT", 10),
    openWindowSeconds: envInteger("OPEN_WINDOW_SECONDS", 45),
    lookaheadSeconds: envInteger("LOOKAHEAD_SECONDS", 900),
    allowLateBuy: envBool("ALLOW_LATE_BUY", false),
    stateFile: envString("STATE_FILE", "data/seen-markets.json"),
    fillsFile: envString("FILLS_FILE", "data/fills.jsonl")
  };
  cfg.broadcastRpcUrls = resolveBroadcastRpcUrls(cfg.rpcUrl);

  if (cfg.stakeUsdt <= 0) throw new Error("STAKE_USDT must be positive");
  if (cfg.stakePerOutcomeUsdt <= 0) throw new Error("STAKE_PER_OUTCOME_USDT must be positive");
  if (cfg.maxStakeUsdt <= 0) throw new Error("MAX_STAKE_USDT must be positive");
  if (cfg.maxMarketStakeUsdt <= 0) throw new Error("MAX_MARKET_STAKE_USDT must be positive");
  if (cfg.maxBatchStakeUsdt <= 0) throw new Error("MAX_BATCH_STAKE_USDT must be positive");
  if (cfg.eventOutcomeCount <= 0) throw new Error("EVENT_OUTCOME_COUNT must be positive");
  if (cfg.stakeUsdt > cfg.maxStakeUsdt) {
    throw new Error(`STAKE_USDT ${cfg.stakeUsdt} exceeds MAX_STAKE_USDT ${cfg.maxStakeUsdt}`);
  }
  if (cfg.stakePerOutcomeUsdt > cfg.maxStakeUsdt) {
    throw new Error(`STAKE_PER_OUTCOME_USDT ${cfg.stakePerOutcomeUsdt} exceeds MAX_STAKE_USDT ${cfg.maxStakeUsdt}`);
  }
  if (cfg.slippageBps < 0 || cfg.slippageBps > 5000) {
    throw new Error("SLIPPAGE_BPS must be between 0 and 5000");
  }
  if (!["all", "lowest_odds"].includes(cfg.eventOutcomeSelection)) {
    throw new Error("EVENT_OUTCOME_SELECTION must be all or lowest_odds");
  }
  if (!["token_order", "error"].includes(cfg.eventOutcomeSelectionFallback)) {
    throw new Error("EVENT_OUTCOME_SELECTION_FALLBACK must be token_order or error");
  }
  if (!["fast", "quoted"].includes(cfg.eventBuyMode)) {
    throw new Error("EVENT_BUY_MODE must be fast or quoted");
  }
  if (!["ws", "chain", "rest"].includes(cfg.eventDiscovery)) {
    throw new Error("EVENT_DISCOVERY must be ws, chain, or rest");
  }
  if (cfg.restDiscoveryPollMs <= 0) {
    throw new Error("REST_DISCOVERY_POLL_MS must be positive");
  }
  validateGasPriceGwei("GAS_PRICE_GWEI", cfg.gasPriceGwei);
  validateGasPriceGwei("SELL_GAS_PRICE_GWEI", cfg.sellGasPriceGwei);
  validateGasPriceGwei("OPERATOR_APPROVE_GAS_PRICE_GWEI", cfg.operatorApproveGasPriceGwei);
  if (!["next_batch", "upper_bound"].includes(cfg.watchFundingMode)) {
    throw new Error("WATCH_FUNDING_MODE must be next_batch or upper_bound");
  }
  if (cfg.fastGasLimit < 0) {
    throw new Error("FAST_GAS_LIMIT must be 0 or a positive integer");
  }
  if (cfg.fastSellGasLimit < 0) {
    throw new Error("FAST_SELL_GAS_LIMIT must be 0 or a positive integer");
  }
  if (cfg.bundleFastGasLimit < 0) {
    throw new Error("BUNDLE_FAST_GAS_LIMIT must be 0 or a positive integer");
  }
  if (cfg.preSignWindowMs < 0) {
    throw new Error("PRE_SIGN_WINDOW_MS must be 0 or a positive integer");
  }
  if (cfg.preSignRetryMs < 0) {
    throw new Error("PRE_SIGN_RETRY_MS must be 0 or a positive integer");
  }
  if (cfg.nonceSyncMinIntervalMs < 0) {
    throw new Error("NONCE_SYNC_MIN_INTERVAL_MS must be 0 or a positive integer");
  }
  if (cfg.receiptWatchTimeoutMs <= 0) {
    throw new Error("RECEIPT_WATCH_TIMEOUT_MS must be positive");
  }
  if (cfg.receiptWatchPollingMs <= 0) {
    throw new Error("RECEIPT_WATCH_POLLING_MS must be positive");
  }
  if (cfg.autoSellPollMs <= 0) {
    throw new Error("AUTO_SELL_POLL_MS must be positive");
  }
  if (!["quote", "manual"].includes(cfg.autoSellMinOutMode)) {
    throw new Error("AUTO_SELL_MIN_OUT_MODE must be quote or manual");
  }
  if (cfg.autoSellManualMinOutUsdt < 0) {
    throw new Error("AUTO_SELL_MANUAL_MIN_OUT_USDT must be 0 or a positive number");
  }
  if (cfg.autoSellProfitMultiplier <= 1) {
    throw new Error("AUTO_SELL_PROFIT_MULTIPLIER must be greater than 1");
  }
  validatePct("AUTO_SELL_PERCENT", cfg.autoSellPercent, { minExclusive: 0, max: 100 });
  validateNonNegativeInteger("AUTO_SELL_TRAILING_START_DELAY_SECONDS", cfg.autoSellTrailingStartDelaySeconds);
  validatePct("AUTO_SELL_TRAILING_ARM_PROFIT_PCT", cfg.autoSellTrailingArmProfitPct, { min: 0 });
  validatePct("AUTO_SELL_TRAILING_DRAWDOWN_PCT", cfg.autoSellTrailingDrawdownPct, { minExclusive: 0, max: 100 });
  validatePct("AUTO_SELL_TRAILING_PERCENT", cfg.autoSellTrailingPercent, { minExclusive: 0, max: 100 });
  validateNonNegativeInteger("AUTO_SELL_ADAPTIVE_START_DELAY_SECONDS", cfg.autoSellAdaptiveStartDelaySeconds);
  validatePct("AUTO_SELL_ADAPTIVE_ARM_PROFIT_PCT", cfg.autoSellAdaptiveArmProfitPct, { min: 0 });
  validateNonNegativeInteger("AUTO_SELL_ADAPTIVE_EARLY_SECONDS", cfg.autoSellAdaptiveEarlySeconds);
  validatePct("AUTO_SELL_ADAPTIVE_EARLY_DRAWDOWN_PCT", cfg.autoSellAdaptiveEarlyDrawdownPct, { minExclusive: 0, max: 100 });
  validateNonNegativeInteger("AUTO_SELL_ADAPTIVE_WINDOW_SECONDS", cfg.autoSellAdaptiveWindowSeconds);
  validatePositiveInteger("AUTO_SELL_ADAPTIVE_MIN_SAMPLES", cfg.autoSellAdaptiveMinSamples);
  validatePct("AUTO_SELL_ADAPTIVE_SMALL_JUMP_PCT", cfg.autoSellAdaptiveSmallJumpPct, { min: 0 });
  validatePct("AUTO_SELL_ADAPTIVE_SMALL_RANGE_PCT", cfg.autoSellAdaptiveSmallRangePct, { min: 0 });
  validatePct("AUTO_SELL_ADAPTIVE_SMALL_DRAWDOWN_PCT", cfg.autoSellAdaptiveSmallDrawdownPct, { minExclusive: 0, max: 100 });
  validatePct("AUTO_SELL_ADAPTIVE_NORMAL_DRAWDOWN_PCT", cfg.autoSellAdaptiveNormalDrawdownPct, { minExclusive: 0, max: 100 });
  validatePct("AUTO_SELL_ADAPTIVE_LARGE_JUMP_PCT", cfg.autoSellAdaptiveLargeJumpPct, { min: 0 });
  validatePct("AUTO_SELL_ADAPTIVE_LARGE_RANGE_PCT", cfg.autoSellAdaptiveLargeRangePct, { min: 0 });
  validatePct("AUTO_SELL_ADAPTIVE_LARGE_DRAWDOWN_PCT", cfg.autoSellAdaptiveLargeDrawdownPct, { minExclusive: 0, max: 100 });
  validatePct("AUTO_SELL_ADAPTIVE_PERCENT", cfg.autoSellAdaptivePercent, { minExclusive: 0, max: 100 });
  validateNonNegativeInteger("AUTO_SELL_WEAK_EXIT_AFTER_OPEN_SECONDS", cfg.autoSellWeakExitAfterOpenSeconds);
  validatePct("AUTO_SELL_WEAK_EXIT_MIN_PEAK_PROFIT_PCT", cfg.autoSellWeakExitMinPeakProfitPct, { min: 0 });
  validatePct("AUTO_SELL_WEAK_EXIT_MAX_CURRENT_PROFIT_PCT", cfg.autoSellWeakExitMaxCurrentProfitPct, { min: -100 });
  validatePct("AUTO_SELL_WEAK_EXIT_PERCENT", cfg.autoSellWeakExitPercent, { minExclusive: 0, max: 100 });
  validateNonNegativeInteger("AUTO_SELL_BREAKEVEN_START_DELAY_SECONDS", cfg.autoSellBreakevenStartDelaySeconds);
  validatePct("AUTO_SELL_BREAKEVEN_ARM_PROFIT_PCT", cfg.autoSellBreakevenArmProfitPct, { min: 0 });
  validatePct("AUTO_SELL_BREAKEVEN_EXIT_PROFIT_PCT", cfg.autoSellBreakevenExitProfitPct, { min: -100 });
  validatePct("AUTO_SELL_BREAKEVEN_PERCENT", cfg.autoSellBreakevenPercent, { minExclusive: 0, max: 100 });
  if (cfg.autoSellPositionLimit <= 0) {
    throw new Error("AUTO_SELL_POSITION_LIMIT must be positive");
  }
  if (cfg.executionRetryMs <= 0) {
    throw new Error("EXECUTION_RETRY_MS must be positive");
  }
  if (cfg.eventOpenWindowSeconds <= 0) {
    throw new Error("EVENT_OPEN_WINDOW_SECONDS must be positive");
  }
  if (cfg.eventBuyDelaySeconds < 0) {
    throw new Error("EVENT_BUY_DELAY_SECONDS must be 0 or positive");
  }
  if (!cfg.allowLateBuy && cfg.eventBuyDelaySeconds >= cfg.eventOpenWindowSeconds) {
    throw new Error("EVENT_BUY_DELAY_SECONDS must be lower than EVENT_OPEN_WINDOW_SECONDS unless ALLOW_LATE_BUY=1");
  }
  if (cfg.minMarketDurationHours < 0) {
    throw new Error("MIN_MARKET_DURATION_HOURS must be 0 or a positive number");
  }
  if (cfg.logChunkBlocks < 0) {
    throw new Error("LOG_CHUNK_BLOCKS must be 0 or a positive integer");
  }
  if (cfg.broadcastTimeoutMs <= 0) {
    throw new Error("BROADCAST_TIMEOUT_MS must be positive");
  }
  if (cfg.rpcWarmupTimeoutMs <= 0) {
    throw new Error("RPC_WARMUP_TIMEOUT_MS must be positive");
  }
  if (cfg.pollMs <= 0) {
    throw new Error("POLL_MS must be positive");
  }
  if (cfg.hotPollMs <= 0) {
    throw new Error("HOT_POLL_MS must be positive");
  }
  if (cfg.preopenHotMs < 0) {
    throw new Error("PREOPEN_HOT_MS must be 0 or a positive integer");
  }
  if (cfg.prebroadcastMs < 0) {
    throw new Error("PREBROADCAST_MS must be 0 or a positive integer");
  }
  if (cfg.wsReceiptFallbackMs < 0) {
    throw new Error("WS_RECEIPT_FALLBACK_MS must be 0 or a positive integer");
  }
  if (cfg.wsReceiptFallbackRetries < 0) {
    throw new Error("WS_RECEIPT_FALLBACK_RETRIES must be 0 or a positive integer");
  }
  if (cfg.watchStartupRetryMs <= 0) {
    throw new Error("WATCH_STARTUP_RETRY_MS must be positive");
  }
  if (cfg.armFundingRetryMs <= 0) {
    throw new Error("ARM_FUNDING_RETRY_MS must be positive");
  }
  if (cfg.armFundingHotRetryMs <= 0) {
    throw new Error("ARM_FUNDING_HOT_RETRY_MS must be positive");
  }
  if (cfg.armFundingHotWindowMs < 0) {
    throw new Error("ARM_FUNDING_HOT_WINDOW_MS must be 0 or a positive integer");
  }
  if (cfg.armCatchUpWindowMs < 0) {
    throw new Error("ARM_CATCH_UP_WINDOW_MS must be 0 or a positive integer");
  }
  if (!["binance_volume_projection", "binance_price_projection", "cheapest", "configured"].includes(cfg.strategy)) {
    throw new Error("STRATEGY must be binance_volume_projection, binance_price_projection, cheapest, or configured");
  }
  if (cfg.strategy === "configured" && !cfg.targetOutcomeRegex) {
    throw new Error("configured strategy requires TARGET_OUTCOME_REGEX");
  }

  ensureParentDir(cfg.stateFile);
  ensureParentDir(cfg.fillsFile);
  ensureParentDir(cfg.notificationStateFile);
  ensureParentDir(cfg.runtimeStatusFile);
  ensureParentDir(cfg.autoSellStateFile);
  ensureParentDir(cfg.autoSellPositionStateFile);
  return cfg;
}

function validatePct(name, value, { min = undefined, minExclusive = undefined, max = undefined } = {}) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  if (min !== undefined && value < min) throw new Error(`${name} must be >= ${min}`);
  if (minExclusive !== undefined && value <= minExclusive) throw new Error(`${name} must be > ${minExclusive}`);
  if (max !== undefined && value > max) throw new Error(`${name} must be <= ${max}`);
}

function validateNonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be 0 or a positive integer`);
}

function validateGasPriceGwei(name, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
}

function validatePositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function loadProviderEnv() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const file = path.join(home, ".codex/secrets/evm-rpc-providers.env");
  loadDotEnv(file);
}

function loadBotConfigEnv() {
  loadDotEnvFile(process.env.BOT_CONFIG_FILE ?? "", { override: true });
}

function readKeychainPrivateKey() {
  if (process.platform !== "darwin" || envBool("DISABLE_KEYCHAIN_PRIVATE_KEY", false)) return "";
  const service = envString("PRIVATE_KEY_KEYCHAIN_SERVICE", "42space-event-bot-private-key");
  const account = envString("PRIVATE_KEY_KEYCHAIN_ACCOUNT", "42space");
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-a",
      account,
      "-s",
      service,
      "-w"
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function readWindowsDpapiPrivateKey() {
  if (process.platform !== "win32" || envBool("DISABLE_WINDOWS_DPAPI_PRIVATE_KEY", false)) return "";
  const file = envString("WINDOWS_DPAPI_PRIVATE_KEY_FILE", "data/private-key.dpapi");
  if (!fs.existsSync(file)) return "";
  const resolved = path.resolve(file);
  const script = `
$ErrorActionPreference = 'Stop'
$encrypted = (Get-Content -Raw -LiteralPath ${psString(resolved)}).Trim()
$secure = $encrypted | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
`;
  try {
    return execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function loadSeen(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(readSeenArray(file));
}

export function saveSeen(file, seen) {
  ensureParentDir(file);
  const dir = path.dirname(file);
  const base = path.basename(file);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  const backup = `${file}.bak`;
  const body = `${JSON.stringify([...seen].sort(), null, 2)}\n`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, backup);
    fs.chmodSync(backup, 0o600);
  }
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function appendJsonl(file, row) {
  ensureParentDir(file);
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

function readSeenArray(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const backup = `${file}.bak`;
    if (fs.existsSync(backup)) {
      const parsed = JSON.parse(fs.readFileSync(backup, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    }
    throw new Error(`Failed to load seen file ${file}: ${error.message}`);
  }
}

function envString(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function envFirst(keys, fallback) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function envOptionalString(key, fallback) {
  const value = process.env[key];
  return value === undefined ? fallback : value;
}

function envNumber(key, fallback) {
  const raw = envString(key, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}

function envInteger(key, fallback) {
  const value = envNumber(key, fallback);
  if (!Number.isInteger(value)) throw new Error(`${key} must be an integer`);
  return value;
}

function envBool(key, fallback) {
  const raw = envString(key, fallback ? "1" : "0").toLowerCase();
  return ["1", "true", "yes", "y"].includes(raw);
}

function envRegex(key, fallback) {
  const raw = envString(key, fallback);
  return raw ? new RegExp(raw, "i") : null;
}

function envList(key, fallback) {
  const raw = envString(key, fallback);
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveBroadcastRpcUrls(primaryRpcUrl) {
  const explicit = envList("BROADCAST_RPC_URLS", "");
  const urls = explicit.length > 0
    ? explicit
    : [
        primaryRpcUrl,
        process.env.CHAINSTACK_BSC_RPC_URL,
        process.env.ANKR_BSC_RPC_URL
      ];
  return uniqueStrings(urls.filter(Boolean).filter((url) => /^https?:\/\//i.test(url)));
}

function uniqueStrings(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const normalized = String(item).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function ensureParentDir(file) {
  const dir = path.dirname(file);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
}

function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
