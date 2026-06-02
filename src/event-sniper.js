#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import readline from "node:readline/promises";
import { promisify } from "node:util";
import { formatUnits, parseUnits } from "viem";
import WebSocket from "ws";
import { appendJsonl, loadSeen, parseArgs, readConfig, saveSeen } from "./config.js";
import {
  approveMarketOperator,
  approveRouterMax,
  approveRouterAmount,
  buildFastSellOutcomePlan,
  buildFastBuyBundlePlan,
  buildDirectBuyAllOutcomesPlan,
  buildMarketFromCreationLog,
  buildMarketsFromControllerLogs,
  buyOutcomesBatch,
  describeFastBundlePlan,
  describeEventPlan,
  describeSellPlan,
  executeFastBuyBundle,
  estimateFastGasReserve,
  estimateSelectedOutcomeCount,
  fetchControllerLogs,
  fetchMarket,
  fetchMarkets,
  fetchOpenPositions,
  getWalletStatus,
  getWalletStatusForAddress,
  makeClients,
  makeWsClient,
  preSignFastBundleTransaction,
  preSignFastBuyTransaction,
  quoteSellOutcome,
  quoteBuyAllOutcomes,
  sellOutcome,
  warmBroadcastRpcClients,
  withPrebuiltFastExecution,
  watchControllerLogs
} from "./fortytwo.js";
import {
  eventSeenKey,
  filterEventMarkets,
  marketCurveBlockReason,
  selectEventMarket,
  summarizeEventMarket
} from "./event-strategy.js";
import { markdownLine, notifyPushPlusSafe, shortHash } from "./pushplus.js";

const execFileAsync = promisify(execFile);
const PUBLIC_TEST_PRIVATE_KEY = [
  "0x",
  "ac0974bec39a17e36",
  "ba4a6b4d238ff944",
  "bacb478cbed5efcae784d7bf4f2ff80"
].join("");
const PUBLIC_TEST_RECEIVER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const REST_DISCOVERY_STATUSES = ["live", "not_started"];
const MARKET_MINT_TOPIC = "0xf2e90b10bd525a6b1fe02d09e8133d3e38c9a87376ed4850904ca21e6e27abec";
const activeDiscoveryKeys = new Set();
const fundingWaitDiscoveryNotifications = new Set();
const persistentNotificationSets = new Map();
const PROCESS_STARTED_AT = new Date().toISOString();

async function main() {
  const [command = "scan", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const cfg = readConfig();
  applyCliExecutionOverrides(cfg, args);

  if (command === "scan") {
    await scan(cfg);
    return;
  }
  if (command === "plan") {
    await plan(cfg, args);
    return;
  }
  if (command === "positions") {
    await positions(cfg, args);
    return;
  }
  if (command === "funding") {
    await funding(cfg, args);
    return;
  }
  if (command === "sell") {
    await sell(cfg, args);
    return;
  }
  if (command === "autosell") {
    await autoSell(cfg, args);
    return;
  }
  if (command === "replay") {
    await replay(cfg, args);
    return;
  }
  if (command === "status") {
    await status(cfg, args);
    return;
  }
  if (command === "rehearse") {
    await rehearse(cfg, args);
    return;
  }
  if (command === "bench") {
    await bench(cfg, args);
    return;
  }
  if (command === "rpc") {
    await rpc(cfg);
    return;
  }
  if (command === "presign-test") {
    await presignTest(cfg, args);
    return;
  }
  if (command === "due-test") {
    await dueTest(cfg, args);
    return;
  }
  if (command === "catchup-test") {
    await catchupTest(cfg, args);
    return;
  }
  if (command === "retry-test") {
    await retryTest(cfg, args);
    return;
  }
  if (command === "deadline-test") {
    await deadlineTest(cfg, args);
    return;
  }
  if (command === "self-test") {
    await selfTest(cfg);
    return;
  }
  if (command === "buy") {
    await buy(cfg, args);
    return;
  }
  if (command === "minimal") {
    await minimal(cfg, args);
    return;
  }
  if (command === "arm") {
    await arm(cfg, args);
    return;
  }
  if (command === "preflight") {
    await preflight(cfg);
    return;
  }
  if (command === "approve") {
    await approve(cfg, args);
    return;
  }
  if (command === "operator-approve" || command === "approve-operator" || command === "approve-sell") {
    await operatorApprove(cfg, args);
    return;
  }
  if (command === "doctor") {
    await doctor(cfg, args);
    return;
  }
  if (command === "watch") {
    await watch(cfg);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function applyCliExecutionOverrides(cfg, args = {}) {
  if (args.dryRun || args.dry || args.noExecute) {
    cfg.dryRun = true;
    cfg.execute = false;
  }
  if (args.execute || args.real) {
    cfg.dryRun = false;
    cfg.execute = true;
  }
}

async function scan(cfg) {
  const markets = await loadEventMarkets(cfg);
  const shown = markets.slice(0, cfg.scanLimit);
  console.log(
    JSON.stringify(
      {
        found: markets.length,
        shown: shown.length,
        markets: shown.map(summarizeEventMarket)
      },
      null,
      2
    )
  );
}

async function plan(cfg, args) {
  const eventPlan = await buildEventPlan(cfg, { ...args, forceQuoted: true });
  console.log(JSON.stringify({ level: "event-plan", plan: describeEventPlan(eventPlan) }, null, 2));
}

async function positions(cfg, args) {
  const walletAddress = args.wallet ?? cfg.walletAddress;
  if (!walletAddress) throw new Error("positions requires --wallet or WALLET_ADDRESS");

  const openPositions = await fetchOpenPositions(cfg, {
    user: walletAddress,
    market: args.market,
    limit: Number(args.limit ?? 100)
  });
  const rows = openPositions.map(summarizePosition);
  const totals = rows.reduce(
    (acc, row) => {
      acc.costBasis += row.costBasisUsdt;
      acc.cashPnl += row.cashPnlUsdt;
      acc.markValue += row.markValueUsdt;
      return acc;
    },
    { costBasis: 0, cashPnl: 0, markValue: 0 }
  );

  console.log(
    JSON.stringify(
      {
        level: "event-positions",
        wallet: walletAddress,
        count: rows.length,
        totals: {
          costBasisUsdt: roundUsd(totals.costBasis),
          cashPnlUsdt: roundUsd(totals.cashPnl),
          markValueUsdt: roundUsd(totals.markValue)
        },
        positions: rows
      },
      null,
      2
    )
  );
}

async function funding(cfg, args) {
  const { publicClient, account } = makeClients(cfg);
  const chain = await loadChainEventMarkets(cfg, { lookbackBlocks: cfg.eventLogLookbackBlocks });
  const requirement = computeFundingRequirement(cfg, chain.eventMarkets);
  const gasReserve = await estimateFastGasReserve(publicClient, cfg, requirement);
  const walletAddress = args.wallet ?? cfg.walletAddress ?? account?.address;

  let wallet = null;
  if (walletAddress) {
    const status = await getWalletStatusForAddress(publicClient, walletAddress);
    wallet = buildFundingWalletSummary(status, requirement, gasReserve);
  }

  console.log(JSON.stringify({
    level: "event-funding",
    wallet,
    requirement,
    gasReserve,
    readyForArm: wallet
      ? wallet.busdtBalanceReady && wallet.busdtAllowanceReady && wallet.bnbReady
      : null,
    topUp: wallet?.topUp ?? null,
    nextBatch: {
      startDate: requirement.nextBatchStartDate,
      marketCount: requirement.nextBatchMarketCount,
      outcomeCount: requirement.nextBatchOutcomeCount,
      availableOutcomeCount: requirement.nextBatchAvailableOutcomeCount,
      totalStakeUsdt: requirement.nextBatchRequiredBusdt,
      markets: requirement.nextBatchMarkets
    },
    chainReplay: {
      head: chain.head,
      fromBlock: chain.fromBlock,
      controllerLogs: chain.controllerLogs,
      createNewMarketLogs: chain.createNewMarketLogs,
      decodedMarkets: chain.decodedMarkets,
      eventMarkets: chain.eventMarkets.length,
      decodeErrors: chain.decodeErrors
    },
    commands: {
      approveIfAllowanceShort: "npm run event:approve",
      armAfterReady: "npm run event:arm",
      positions: walletAddress ? `npm run event:positions -- --wallet ${walletAddress}` : "npm run event:positions -- --wallet 0x...",
      sellQuote: walletAddress ? `npm run event:sell -- --wallet ${walletAddress} --all` : "npm run event:sell -- --wallet 0x... --all"
    }
  }, null, 2));
}

async function sell(cfg, args) {
  if (!cfg.dryRun && cfg.execute && !cfg.privateKey) {
    cfg.privateKey = await promptHidden("PRIVATE_KEY for event:sell (hidden): ");
  }
  const { publicClient, account } = makeClients(cfg);
  const walletAddress = args.wallet ?? cfg.walletAddress ?? account?.address;
  if (!walletAddress) throw new Error("sell requires --wallet, WALLET_ADDRESS, or PRIVATE_KEY");

  if (!cfg.dryRun && cfg.execute && account && walletAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Real sell wallet must match PRIVATE_KEY-derived address");
  }

  const openPositions = await fetchOpenPositions(cfg, {
    user: walletAddress,
    market: args.market,
    limit: Number(args.limit ?? 500)
  });
  const selected = selectSellPositions(openPositions, args);
  const percent = Number(args.percent ?? 100);
  const amountOt = args.amountOt ?? args.amount;
  const fastSell = Boolean(args.fastSell || args.quickSell || args.noQuote);
  const minOutUsdt = args.minOutUsdt ?? args.minOut ?? "0.000001";

  if (amountOt && selected.length !== 1) {
    throw new Error("--amount-ot/--amount can only be used when exactly one position is selected");
  }

  const plans = [];
  for (const position of selected) {
    const plan = fastSell
      ? await buildFastSellOutcomePlan(publicClient, {
          market: position.marketAddress,
          tokenId: position.tokenId,
          owner: walletAddress,
          amountOt,
          percent,
          minOutUsdt
        })
      : await quoteSellOutcome(publicClient, {
          market: position.marketAddress,
          tokenId: position.tokenId,
          owner: walletAddress,
          amountOt,
          percent,
          slippageBps: cfg.slippageBps
        });
    plans.push({
      position,
      plan
    });
  }

  const executions = [];
  if (!cfg.dryRun && cfg.execute) {
    for (const item of plans) {
      executions.push(await sellOutcome(cfg, item.plan));
    }
  }

  console.log(JSON.stringify({
    level: "event-sell",
    mode: cfg.dryRun || !cfg.execute ? "dry-run" : "execute",
    sellMode: fastSell ? "fast" : "quoted",
    wallet: walletAddress,
    selectedCount: selected.length,
    totals: summarizeSellPlans(plans.map((item) => item.plan)),
    positions: plans.map(({ position, plan }) => ({
      question: position.question?.title ?? null,
      outcome: position.outcome?.name ?? null,
      marketAddress: position.marketAddress,
      tokenId: position.tokenId,
      costBasisUsdt: roundUsd(Number(position.costBasis ?? 0)),
      cashPnlUsdt: roundUsd(Number(position.cashPnl ?? 0)),
      quote: describeSellPlan(plan, { dryRun: cfg.dryRun || !cfg.execute })
    })),
    executions
  }, null, 2));
}

async function autoSell(cfg, args) {
  if (args.execute || args.real) {
    cfg.dryRun = false;
    cfg.execute = true;
    cfg.riskAck = "YES";
    cfg.eligibilityAck = "YES";
  }
  if (!cfg.dryRun && cfg.execute && !cfg.privateKey) {
    cfg.privateKey = await promptHidden("PRIVATE_KEY for event:autosell (hidden): ");
  }
  const seen = loadSeen(cfg.autoSellStateFile);
  const result = await runAutoSellOnce(cfg, {
    seen,
    source: "manual"
  });
  console.log(JSON.stringify({
    level: "event-auto-sell",
    mode: cfg.dryRun || !cfg.execute ? "dry-run" : "execute",
    ...result
  }, null, 2));
}

async function replay(cfg, args) {
  const { publicClient } = makeClients(cfg);
  const head = await publicClient.getBlockNumber();
  const lookback = BigInt(args.lookbackBlocks ?? cfg.replayLookbackBlocks);
  const fromBlock = head > lookback ? head - lookback : 0n;
  const logs = await fetchControllerLogs(publicClient, { fromBlock, toBlock: head, chunkSize: cfg.logChunkBlocks });
  const { decoded, decodeErrors } = await decodeControllerMarketLogs(publicClient, logs, {
    createdAt: new Date().toISOString(),
    fallback: true
  });

  const eventMarkets = sortMarketsByChainDesc(filterEventMarkets(decoded, cfg));
  const latestEvent = eventMarkets[0] ?? null;
  const latestEventForPlan = latestEvent ? await maybeHydrateMarketOdds(cfg, latestEvent) : null;
  const fastPlan = latestEventForPlan ? buildDirectBuyAllOutcomesPlan(latestEventForPlan, cfg) : null;

  console.log(
    JSON.stringify(
      {
        level: "replay",
        head: head.toString(),
        fromBlock: fromBlock.toString(),
        controllerLogs: logs.length,
        createNewMarketLogs: countCreationLogs(logs),
        decodedMarkets: decoded.length,
        eventMarkets: eventMarkets.length,
        latestEvent: latestEvent
          ? {
              question: latestEvent.question,
              address: latestEvent.address,
              startDate: latestEvent.startDate,
              endDate: latestEvent.endDate,
              outcomeCount: latestEvent.outcomes.length,
              transactionHash: latestEvent.transactionHash,
              blockNumber: latestEvent.blockNumber
            }
          : null,
        fastPlan: fastPlan ? describeEventPlan(fastPlan) : null,
        decodeErrors
      },
      null,
      2
    )
  );
}

async function status(cfg, args) {
  const { publicClient } = makeClients(cfg);
  const [liveMarkets, chain, restFutureMarkets] = await Promise.all([
    loadEventMarkets(cfg, { limit: cfg.watchScanLimit }),
    loadChainEventMarkets(cfg, args),
    loadUpcomingRestEventMarkets(cfg)
  ]);
  const fundingMarkets = mergeMarketLists(chain.eventMarkets, restFutureMarkets);
  const funding = computeFundingRequirement(cfg, fundingMarkets);
  const [gasReserve, minimumGasReserve] = await Promise.all([
    estimateFastGasReserve(publicClient, cfg, funding),
    estimateFastGasReserve(publicClient, cfg, minimumExecutionFunding(funding))
  ]);
  const walletAddress = args.wallet ?? cfg.walletAddress;
  let wallet = null;
  if (walletAddress) {
    try {
      const statusResult = await getWalletStatusForAddress(publicClient, walletAddress);
      const readiness = walletFundingReadiness(statusResult, funding, gasReserve, minimumGasReserve);
      wallet = {
        ...statusResult,
        requiredBusdt: funding.requiredBusdt,
        minimumRequiredBusdt: funding.minimumRequiredBusdt,
        fullBatchRequiredBusdt: funding.requiredBusdt,
        requiredBusdtUpperBound: funding.upperBoundRequiredBusdt,
        fundingMode: funding.mode,
        ...readiness
      };
    } catch (error) {
      wallet = { ok: false, message: errorMessage(error) };
    }
  }

  const futureMarkets = fundingMarkets
    .filter((market) => msUntilStart(market) > 0)
    .sort(compareStartAsc);
  const latestLive = liveMarkets[0] ?? null;
  const latestLivePlan = latestLive ? safeDescribeDirectPlan(latestLive, cfg) : null;
  const future = await Promise.all(futureMarkets.slice(0, cfg.scanLimit).map(async (market) => {
    const record = await preparePendingRecord(cfg, market, null);
    return {
      question: market.question,
      address: market.address,
      startDate: market.startDate,
      endDate: market.endDate,
      msUntilStart: msUntilStart(market),
      msUntilAction: msUntilAction(market, cfg),
      outcomeCount: selectedOutcomeCount(market, cfg),
      availableOutcomeCount: market.outcomes?.length ?? 0,
      totalStakeUsdt: selectedStakeUsdt(market, cfg),
      prepared: Boolean(record.preparedPlan),
      prepareError: record.prepareError,
      transactionHash: market.transactionHash,
      blockNumber: market.blockNumber
    };
  }));

  console.log(JSON.stringify({
    level: "event-status",
    mode: cfg.dryRun || !cfg.execute ? "dry-run" : "execute",
    wallet,
    funding,
    gasReserve,
    requiredBusdtUpperBound: funding.upperBoundRequiredBusdt,
    watchConfig: {
      eventDiscovery: cfg.eventDiscovery,
      wsProvider: wsProviderLabel(cfg.wsUrl),
      eventBuyMode: cfg.eventBuyMode,
      watchFundingMode: cfg.watchFundingMode,
      bundleDueMarkets: cfg.bundleDueMarkets,
      restDiscoveryEnabled: cfg.restDiscoveryEnabled,
      restDiscoveryPollMs: cfg.restDiscoveryPollMs,
      stakePerOutcomeUsdt: cfg.stakePerOutcomeUsdt,
      eventOutcomeSelection: cfg.eventOutcomeSelection,
      eventOutcomeCount: cfg.eventOutcomeCount,
      eventOutcomeSelectionFallback: cfg.eventOutcomeSelectionFallback,
      marketAddressBlocklist: cfg.marketAddressBlocklist,
      marketQuestionBlocklist: cfg.marketQuestionBlocklist,
      allowOnchainOnlyMarkets: cfg.allowOnchainOnlyMarkets,
      autoSellEnabled: cfg.autoSellEnabled,
      autoSellOriginalEnabled: cfg.autoSellOriginalEnabled,
      autoSellProfitMultiplier: cfg.autoSellProfitMultiplier,
      autoSellPercent: cfg.autoSellPercent,
      autoSellFixedTrailingEnabled: cfg.autoSellFixedTrailingEnabled,
      autoSellTrailingStartDelaySeconds: cfg.autoSellTrailingStartDelaySeconds,
      autoSellTrailingArmProfitPct: cfg.autoSellTrailingArmProfitPct,
      autoSellTrailingDrawdownPct: cfg.autoSellTrailingDrawdownPct,
      autoSellTrailingPercent: cfg.autoSellTrailingPercent,
      autoSellAdaptiveTrailingEnabled: cfg.autoSellAdaptiveTrailingEnabled,
      autoSellAdaptiveStartDelaySeconds: cfg.autoSellAdaptiveStartDelaySeconds,
      autoSellAdaptiveArmProfitPct: cfg.autoSellAdaptiveArmProfitPct,
      autoSellAdaptiveEarlySeconds: cfg.autoSellAdaptiveEarlySeconds,
      autoSellAdaptiveEarlyDrawdownPct: cfg.autoSellAdaptiveEarlyDrawdownPct,
      autoSellAdaptiveWindowSeconds: cfg.autoSellAdaptiveWindowSeconds,
      autoSellAdaptiveMinSamples: cfg.autoSellAdaptiveMinSamples,
      autoSellAdaptiveSmallJumpPct: cfg.autoSellAdaptiveSmallJumpPct,
      autoSellAdaptiveSmallRangePct: cfg.autoSellAdaptiveSmallRangePct,
      autoSellAdaptiveSmallDrawdownPct: cfg.autoSellAdaptiveSmallDrawdownPct,
      autoSellAdaptiveNormalDrawdownPct: cfg.autoSellAdaptiveNormalDrawdownPct,
      autoSellAdaptiveLargeJumpPct: cfg.autoSellAdaptiveLargeJumpPct,
      autoSellAdaptiveLargeRangePct: cfg.autoSellAdaptiveLargeRangePct,
      autoSellAdaptiveLargeDrawdownPct: cfg.autoSellAdaptiveLargeDrawdownPct,
      autoSellAdaptivePercent: cfg.autoSellAdaptivePercent,
      autoSellWeakExitEnabled: cfg.autoSellWeakExitEnabled,
      autoSellWeakExitAfterOpenSeconds: cfg.autoSellWeakExitAfterOpenSeconds,
      autoSellWeakExitMinPeakProfitPct: cfg.autoSellWeakExitMinPeakProfitPct,
      autoSellWeakExitMaxCurrentProfitPct: cfg.autoSellWeakExitMaxCurrentProfitPct,
      autoSellWeakExitPercent: cfg.autoSellWeakExitPercent,
      autoSellBreakevenEnabled: cfg.autoSellBreakevenEnabled,
      autoSellBreakevenStartDelaySeconds: cfg.autoSellBreakevenStartDelaySeconds,
      autoSellBreakevenArmProfitPct: cfg.autoSellBreakevenArmProfitPct,
      autoSellBreakevenExitProfitPct: cfg.autoSellBreakevenExitProfitPct,
      autoSellBreakevenPercent: cfg.autoSellBreakevenPercent,
      autoSellPollMs: cfg.autoSellPollMs,
      autoSellMinOutMode: cfg.autoSellMinOutMode,
      autoSellManualMinOutUsdt: cfg.autoSellManualMinOutUsdt,
      maxBatchStakeUsdt: cfg.maxBatchStakeUsdt,
      fastSkipPreflight: cfg.fastSkipPreflight,
      fastSkipDueRestHydration: cfg.fastSkipDueRestHydration,
      fanoutBroadcast: cfg.fanoutBroadcast,
      broadcastRpcCount: cfg.broadcastRpcUrls.length,
      preSignFastTx: cfg.preSignFastTx,
      preSignWindowMs: cfg.preSignWindowMs,
      preSignRetryMs: cfg.preSignRetryMs,
      nonceSyncBeforePreSign: cfg.nonceSyncBeforePreSign,
      nonceSyncMinIntervalMs: cfg.nonceSyncMinIntervalMs,
      asyncReceiptWatch: cfg.asyncReceiptWatch,
      receiptWatchTimeoutMs: cfg.receiptWatchTimeoutMs,
      receiptWatchPollingMs: cfg.receiptWatchPollingMs,
      executionRetryMs: cfg.executionRetryMs,
      eventOpenWindowSeconds: cfg.eventOpenWindowSeconds,
      eventBuyDelaySeconds: cfg.eventBuyDelaySeconds,
      requireRestBeforeBuy: cfg.requireRestBeforeBuy,
      requireRestStatus: cfg.requireRestStatus,
      requireQuoteBeforeBuy: cfg.requireQuoteBeforeBuy,
      requireChainMintBeforeBuy: cfg.requireChainMintBeforeBuy,
      pollMs: cfg.pollMs,
      hotPollMs: cfg.hotPollMs,
      preopenHotMs: cfg.preopenHotMs,
      prebroadcastMs: cfg.prebroadcastMs,
      wsReceiptFallbackMs: cfg.wsReceiptFallbackMs,
      wsReceiptFallbackRetries: cfg.wsReceiptFallbackRetries
    },
    live: {
      count: liveMarkets.length,
      latestPlan: latestLivePlan
    },
    chainReplay: {
      head: chain.head,
      fromBlock: chain.fromBlock,
      controllerLogs: chain.controllerLogs,
      createNewMarketLogs: chain.createNewMarketLogs,
      decodedMarkets: chain.decodedMarkets,
      eventMarkets: chain.eventMarkets.length,
      decodeErrors: chain.decodeErrors
    },
    future
  }, null, 2));
}

async function rehearse(cfg, args) {
  cfg.dryRun = true;
  cfg.execute = false;
  cfg.eventBuyMode = "fast";
  const chain = await loadChainEventMarkets(cfg, args);
  const futureMarkets = chain.eventMarkets
    .filter((market) => msUntilStart(market) > 0)
    .sort(compareStartAsc);
  const market = args.market
    ? selectEventMarket(chain.eventMarkets, args)
    : futureMarkets[0] ?? chain.eventMarkets[0];
  if (!market) throw new Error("No Event Market found for rehearsal");

  const forcedMarket = {
    ...market,
    startDate: new Date(Date.now() - 1000).toISOString()
  };
  const record = await preparePendingRecord(cfg, forcedMarket, null);
  const eventPlan = record.preparedPlan ?? buildDirectBuyAllOutcomesPlan(forcedMarket, cfg);
  console.log(JSON.stringify({
    level: "event-rehearsal",
    sourceMarket: {
      question: market.question,
      address: market.address,
      originalStartDate: market.startDate,
      forcedStartDate: forcedMarket.startDate,
      msUntilOriginalStart: msUntilStart(market),
      outcomeCount: selectedOutcomeCount(market, cfg),
      availableOutcomeCount: market.outcomes?.length ?? 0,
      transactionHash: market.transactionHash,
      blockNumber: market.blockNumber
    },
    prepared: Boolean(record.preparedPlan),
    prebuiltCalldata: Boolean(record.prebuiltCalldata),
    prepareError: record.prepareError,
    plan: describeEventPlan(eventPlan)
  }, null, 2));
}

function safeDescribeDirectPlan(market, cfg) {
  try {
    return describeEventPlan(buildDirectBuyAllOutcomesPlan(market, cfg));
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error),
      market: {
        question: market.question,
        address: market.address,
        startDate: market.startDate,
        endDate: market.endDate,
        outcomeCount: selectedOutcomeCount(market, cfg),
        availableOutcomeCount: market.outcomes?.length ?? 0,
        totalStakeUsdt: roundUsd(selectedStakeUsdt(market, cfg))
      }
    };
  }
}

async function bench(cfg, args) {
  const samples = Number(args.samples ?? 3);
  const results = [];
  const chainStart = performance.now();
  const chain = await loadChainEventMarkets(cfg, args);
  const chainMs = performance.now() - chainStart;
  const futureMarkets = chain.eventMarkets
    .filter((market) => msUntilStart(market) > 0)
    .sort(compareStartAsc);
  const startDate = args.startDate ?? futureMarkets[0]?.startDate;
  if (!startDate) throw new Error("No future Event Market found for benchmark");
  const startMs = new Date(startDate).getTime();
  const batch = futureMarkets.filter((market) => new Date(market.startDate).getTime() === startMs);
  if (batch.length === 0) throw new Error(`No Event Markets found at startDate ${startDate}`);

  const benchCfg = {
    ...cfg,
    privateKey: PUBLIC_TEST_PRIVATE_KEY,
    dryRun: false,
    execute: true,
    riskAck: "YES",
    eligibilityAck: "YES",
    eventBuyMode: "fast"
  };
  const hydrationStart = performance.now();
  const hydratedBatch = await Promise.all(batch.map((market) => maybeHydrateMarketOdds(benchCfg, market)));
  const oddsHydrationMs = performance.now() - hydrationStart;

  for (let i = 0; i < samples; i += 1) {
    const planStart = performance.now();
    const plans = hydratedBatch.map((market) =>
      withPrebuiltFastExecution(buildDirectBuyAllOutcomesPlan(market, benchCfg), PUBLIC_TEST_RECEIVER)
    );
    const planBuildMs = performance.now() - planStart;

    const bundleStart = performance.now();
    const bundle = buildFastBuyBundlePlan(benchCfg, plans, PUBLIC_TEST_RECEIVER);
    const bundleBuildMs = performance.now() - bundleStart;

    const signStart = performance.now();
    const runtime = { receiverAddress: PUBLIC_TEST_RECEIVER, nextNonce: 1000 + i };
    const signed = await preSignFastBundleTransaction(benchCfg, bundle, runtime);
    const preSignMs = performance.now() - signStart;

    results.push({
      sample: i + 1,
      planBuildMs: roundMs(planBuildMs),
      bundleBuildMs: roundMs(bundleBuildMs),
      preSignMs: roundMs(preSignMs),
      totalHotPathMs: roundMs(planBuildMs + bundleBuildMs + preSignMs),
      txHash: signed.txHash,
      nonce: signed.nonce,
      rawLength: signed.serializedTransaction.length
    });
  }

  console.log(JSON.stringify({
    level: "event-bench",
    note: "offline benchmark only; uses a public test private key and does not broadcast",
    chainLoadMs: roundMs(chainMs),
    oddsHydrationMs: roundMs(oddsHydrationMs),
    head: chain.head,
    fromBlock: chain.fromBlock,
    marketBatch: {
      startDate,
      marketCount: batch.length,
      outcomeCount: batchSelectedOutcomeCount(batch, cfg),
      availableOutcomeCount: batch.reduce((sum, market) => sum + (market.outcomes?.length ?? 0), 0),
      totalStakeUsdt: batchSelectedStakeUsdt(batch, cfg),
      markets: batch.map((market) => ({
        question: market.question,
        address: market.address,
        outcomeCount: selectedOutcomeCount(market, cfg),
        availableOutcomeCount: market.outcomes?.length ?? 0
      }))
    },
    config: {
      stakePerOutcomeUsdt: cfg.stakePerOutcomeUsdt,
      eventOutcomeSelection: cfg.eventOutcomeSelection,
      eventOutcomeCount: cfg.eventOutcomeCount,
      eventOutcomeSelectionFallback: cfg.eventOutcomeSelectionFallback,
      autoSellEnabled: cfg.autoSellEnabled,
      autoSellProfitMultiplier: cfg.autoSellProfitMultiplier,
      autoSellPercent: cfg.autoSellPercent,
      autoSellPollMs: cfg.autoSellPollMs,
      autoSellMinOutMode: cfg.autoSellMinOutMode,
      autoSellManualMinOutUsdt: cfg.autoSellManualMinOutUsdt,
      maxBatchStakeUsdt: cfg.maxBatchStakeUsdt,
      fastGasLimit: cfg.fastGasLimit,
      bundleFastGasLimit: cfg.bundleFastGasLimit,
      gasPriceGwei: cfg.gasPriceGwei,
      sellGasPriceGwei: cfg.sellGasPriceGwei,
      operatorApproveGasPriceGwei: cfg.operatorApproveGasPriceGwei,
      fanoutBroadcast: cfg.fanoutBroadcast,
      broadcastRpcCount: cfg.broadcastRpcUrls.length
    },
    samples: results,
    summary: summarizeBenchResults(results)
  }, null, 2));
}

async function rpc(cfg) {
  const warmup = await warmBroadcastRpcClients(cfg);
  console.log(JSON.stringify({
    level: "event-broadcast-rpc",
    fanoutBroadcast: cfg.fanoutBroadcast,
    broadcastRpcCount: cfg.broadcastRpcUrls.length,
    broadcastTimeoutMs: cfg.broadcastTimeoutMs,
    rpcWarmupTimeoutMs: cfg.rpcWarmupTimeoutMs,
    warmup
  }, null, 2));
}

async function presignTest(cfg, args) {
  const { chain, batch, startDate, testCfg, runtime, records } = await buildPresignTestRecords(cfg, args);

  const signStart = performance.now();
  await attachPreSignedFastBundleTransaction(testCfg, records, runtime);
  const signMs = performance.now() - signStart;
  const cachedStart = performance.now();
  const cachedBundle = reusablePreSignedBundle(records);
  const cachedLookupMs = performance.now() - cachedStart;
  const signed = records[0]?.preSignedFastBundleTransaction ?? null;

  console.log(JSON.stringify({
    level: "event-presign-test",
    note: "offline presign/cache test only; uses a public test private key and does not broadcast",
    chainLoad: {
      head: chain.head,
      fromBlock: chain.fromBlock
    },
    marketBatch: {
      startDate,
      marketCount: batch.length,
      outcomeCount: batchSelectedOutcomeCount(batch, testCfg),
      availableOutcomeCount: batch.reduce((sum, market) => sum + (market.outcomes?.length ?? 0), 0),
      totalStakeUsdt: batchSelectedStakeUsdt(batch, testCfg),
      markets: batch.map((market) => ({
        question: market.question,
        address: market.address,
        outcomeCount: selectedOutcomeCount(market, testCfg),
        availableOutcomeCount: market.outcomes?.length ?? 0
      }))
    },
    preparedRecordCount: records.length,
    prebuiltRecordCount: records.filter((record) => record.prebuiltCalldata).length,
    signed: signed
      ? {
          txHash: signed.txHash,
          nonce: signed.nonce,
          rawLength: signed.serializedTransaction.length,
          marketCount: signed.marketCount,
          outcomeCount: signed.outcomeCount
        }
      : null,
    cache: {
      reusable: Boolean(cachedBundle),
      sameTxHash: Boolean(cachedBundle && signed && cachedBundle.preSignedFastBundleTransaction.txHash === signed.txHash),
      marketCount: cachedBundle?.marketCount ?? null,
      outcomeCount: cachedBundle?.outcomeCount ?? null
    },
    runtime: {
      startNonce: 1000,
      nextNonceAfterPresign: runtime.nextNonce
    },
    timing: {
      preSignBundleMs: roundMs(signMs),
      cachedBundleLookupMs: roundMs(cachedLookupMs)
    }
  }, null, 2));
}

async function dueTest(cfg, args) {
  const { chain, batch, startDate, testCfg, runtime, records } = await buildPresignTestRecords(cfg, args);
  await attachPreSignedFastBundleTransaction(testCfg, records, runtime);
  const cachedBundle = reusablePreSignedBundle(records);
  if (!cachedBundle) throw new Error("Due test expected a reusable pre-signed bundle");

  const dueCfg = {
    ...testCfg,
    dryRun: true,
    execute: false,
    stateFile: tempFile(`42space-due-test-seen-${Date.now()}.json`),
    fillsFile: tempFile(`42space-due-test-fills-${Date.now()}.jsonl`)
  };
  const forcedStartDate = new Date(Date.now() - 1000).toISOString();
  const pending = new Map();
  const seen = new Set();
  for (const record of records) {
    record.market = { ...record.market, startDate: forcedStartDate };
    pending.set(eventSeenKey(record.market, dueCfg), record);
  }

  const drainStart = performance.now();
  await drainDuePendingMarkets(dueCfg, seen, pending, runtime);
  const drainMs = performance.now() - drainStart;

  console.log(JSON.stringify({
    level: "event-due-test",
    note: "offline due-path test only; uses a public test private key for pre-signing and dry-run execution, no broadcast",
    chainLoad: {
      head: chain.head,
      fromBlock: chain.fromBlock
    },
    marketBatch: {
      originalStartDate: startDate,
      forcedStartDate,
      marketCount: batch.length,
      outcomeCount: batchSelectedOutcomeCount(batch, dueCfg),
      availableOutcomeCount: batch.reduce((sum, market) => sum + (market.outcomes?.length ?? 0), 0),
      totalStakeUsdt: batchSelectedStakeUsdt(batch, dueCfg)
    },
    preSigned: {
      txHash: cachedBundle.preSignedFastBundleTransaction.txHash,
      nonce: cachedBundle.preSignedFastBundleTransaction.nonce,
      marketCount: cachedBundle.marketCount,
      outcomeCount: cachedBundle.outcomeCount
    },
    duePath: {
      pendingRemaining: pending.size,
      seenCount: seen.size,
      dryRun: dueCfg.dryRun,
      fillsFile: dueCfg.fillsFile,
      stateFile: dueCfg.stateFile,
      usedCachedBundleBeforeDrain: true
    },
    runtime: {
      startNonce: 1000,
      nextNonceAfterDueTest: runtime.nextNonce
    },
    timing: {
      drainDueMs: roundMs(drainMs)
    }
  }, null, 2));
}

async function catchupTest(cfg, args) {
  const { chain, batch, startDate, testCfg } = await buildPresignTestRecords(cfg, args);
  const now = Date.now();
  const ageMs = Number(args.ageMs ?? 1000);
  const catchUpCfg = {
    ...testCfg,
    dryRun: true,
    execute: false,
    eventBuyDelaySeconds: 0,
    requireRestBeforeBuy: false,
    requireRestStatus: [],
    requireQuoteBeforeBuy: false,
    armCatchUpAfterFunding: true,
    armCatchUpWindowMs: Number(args.windowMs ?? (cfg.armCatchUpWindowMs > 0 ? cfg.armCatchUpWindowMs : 60000)),
    stateFile: tempFile(`42space-catchup-test-seen-${now}.json`),
    fillsFile: tempFile(`42space-catchup-test-fills-${now}.jsonl`)
  };
  const forcedStartDate = new Date(now - ageMs).toISOString();
  const markets = batch.map((market) => ({
    ...market,
    status: "live",
    startDate: forcedStartDate
  }));
  const fundingRecovery = {
    enabled: true,
    waitingSince: now - Math.max(ageMs, catchUpCfg.armCatchUpWindowMs),
    fundingReadyAt: now
  };
  const catchUpMarkets = markets.filter((market) =>
    shouldCatchUpLiveMarket(catchUpCfg, market, { fundingRecovery })
  );
  const seen = new Set();
  const pending = new Map();
  const catchUpStart = performance.now();
  await handleDiscoveredMarkets(catchUpCfg, seen, pending, catchUpMarkets, null, {
    source: "catchup-test",
    notify: false,
    hydrateDueOdds: true,
    hydrationSkipReason: "catchup_test"
  });
  const catchUpMs = performance.now() - catchUpStart;

  console.log(JSON.stringify({
    level: "event-catchup-test",
    note: "offline catch-up test only; forces next future batch to look just-started and dry-runs execution, no broadcast",
    chainLoad: {
      head: chain.head,
      fromBlock: chain.fromBlock
    },
    marketBatch: {
      originalStartDate: startDate,
      forcedStartDate,
      forcedAgeMs: ageMs,
      catchUpWindowMs: catchUpCfg.armCatchUpWindowMs,
      marketCount: batch.length,
      catchUpCandidateCount: catchUpMarkets.length,
      outcomeCount: batchSelectedOutcomeCount(batch, catchUpCfg),
      availableOutcomeCount: batch.reduce((sum, market) => sum + (market.outcomes?.length ?? 0), 0),
      totalStakeUsdt: batchSelectedStakeUsdt(batch, catchUpCfg)
    },
    catchUpPath: {
      seenCount: seen.size,
      pendingRemaining: pending.size,
      dryRun: catchUpCfg.dryRun,
      fillsFile: catchUpCfg.fillsFile,
      stateFile: catchUpCfg.stateFile
    },
    timing: {
      catchUpMs: roundMs(catchUpMs)
    }
  }, null, 2));
}

async function retryTest(cfg, args) {
  const { chain, batch, startDate, testCfg, records } = await buildPresignTestRecords(cfg, args);
  const retryCfg = {
    ...testCfg,
    dryRun: true,
    execute: false,
    executionRetryMs: Number(args.executionRetryMs ?? cfg.executionRetryMs)
  };
  const record = records[0];
  record.market = { ...record.market, startDate: new Date(Date.now() - 1000).toISOString() };

  const beforeRetryWaitMs = msUntilRecordAction(record, retryCfg);
  if (beforeRetryWaitMs !== 0) {
    throw new Error(`Retry test expected due record before failure, got ${beforeRetryWaitMs}ms`);
  }

  markExecutionRetry(record, retryCfg, new Error("simulated execution failure"));
  const afterFailureWaitMs = msUntilRecordAction(record, retryCfg);
  if (afterFailureWaitMs <= 0 || afterFailureWaitMs > retryCfg.executionRetryMs) {
    throw new Error(`Retry test expected retry wait within ${retryCfg.executionRetryMs}ms, got ${afterFailureWaitMs}ms`);
  }
  await sleep(retryCfg.executionRetryMs + 25);
  const afterCooldownWaitMs = msUntilRecordAction(record, retryCfg);
  if (afterCooldownWaitMs !== 0) {
    throw new Error(`Retry test expected due record after cooldown, got ${afterCooldownWaitMs}ms`);
  }

  const marks = {
    dryRun: executionMarksSeen({ dryRun: true }),
    success: executionMarksSeen({ status: "success" }),
    broadcast: executionMarksSeen({ status: "broadcast" }),
    reverted: executionMarksSeen({ status: "reverted" })
  };
  if (!marks.dryRun || !marks.success || marks.broadcast || marks.reverted) {
    throw new Error(`Retry test completion classifier failed: ${JSON.stringify(marks)}`);
  }

  console.log(JSON.stringify({
    level: "event-retry-test",
    note: "offline retry classifier test only; no broadcast",
    chainLoad: {
      head: chain.head,
      fromBlock: chain.fromBlock
    },
    marketBatch: {
      originalStartDate: startDate,
      marketCount: batch.length,
      testedMarket: pendingMarket(record).address
    },
    retry: {
      executionRetryMs: retryCfg.executionRetryMs,
      beforeRetryWaitMs,
      afterFailureWaitMs: roundMs(afterFailureWaitMs),
      afterCooldownWaitMs,
      executionAttempts: record.executionAttempts,
      hasExecutionError: Boolean(record.executionError)
    },
    completionClassifier: marks
  }, null, 2));
}

async function deadlineTest(cfg, args) {
  const now = Date.now();
  const testCfg = {
    ...cfg,
    dryRun: true,
    execute: false,
    eventOpenWindowSeconds: Number(args.windowSeconds ?? cfg.eventOpenWindowSeconds),
    stateFile: tempFile(`42space-deadline-test-seen-${now}.json`),
    fillsFile: tempFile(`42space-deadline-test-fills-${now}.jsonl`)
  };
  const staleMarket = {
    address: "0x0000000000000000000000000000000000000042",
    question: "Deadline test Event Market",
    status: "live",
    createdAt: new Date(now - 120000).toISOString(),
    startDate: new Date(now - (testCfg.eventOpenWindowSeconds * 1000 + 1000)).toISOString(),
    endDate: new Date(now + 3600000).toISOString(),
    outcomes: [
      { tokenId: "1", name: "A", price: 0.5, payout: 2 },
      { tokenId: "2", name: "B", price: 0.5, payout: 2 }
    ],
    categories: ["Crypto"],
    tags: ["Normal"]
  };
  const pending = new Map();
  const seen = new Set();
  pending.set(eventSeenKey(staleMarket, testCfg), {
    market: staleMarket,
    preparedPlan: null,
    executionAttempts: 1,
    executionRetryAfterMs: now - 1
  });

  await drainDuePendingMarkets(testCfg, seen, pending, null);
  const expectedKey = eventSeenKey(staleMarket, testCfg);
  if (pending.size !== 0 || !seen.has(expectedKey)) {
    throw new Error(`Deadline test expected stale market skipped; pending=${pending.size} seen=${seen.size}`);
  }

  console.log(JSON.stringify({
    level: "event-deadline-test",
    note: "offline open-window deadline test only; no broadcast",
    eventOpenWindowSeconds: testCfg.eventOpenWindowSeconds,
    skipped: seen.has(expectedKey),
    pendingRemaining: pending.size,
    fillsFile: testCfg.fillsFile,
    stateFile: testCfg.stateFile
  }, null, 2));
}

async function selfTest(cfg) {
  const testCfg = {
    ...cfg,
    privateKey: PUBLIC_TEST_PRIVATE_KEY,
    walletAddress: PUBLIC_TEST_RECEIVER,
    dryRun: true,
    execute: false,
    eventBuyMode: "fast",
    eventOutcomeSelection: "lowest_odds",
    eventOutcomeCount: 5,
    eventOutcomeSelectionFallback: "token_order",
    stakePerOutcomeUsdt: 5,
    maxStakeUsdt: 25,
    maxMarketStakeUsdt: 25,
    maxBatchStakeUsdt: 100,
    minMarketDurationHours: 48,
    marketCategoryBlocklist: ["Price"],
    marketTagBlocklist: ["8 hour", "automated"],
    marketAddressBlocklist: [],
    marketQuestionBlocklist: []
  };
  const passed = [];

  const lowestOddsPlan = buildDirectBuyAllOutcomesPlan(mockEventMarket(), testCfg);
  assertSelfTest(
    lowestOddsPlan.selection?.rankSource === "payout",
    `expected payout ranking, got ${lowestOddsPlan.selection?.rankSource}`
  );
  assertArrayEqual(
    lowestOddsPlan.outcomes.map((outcome) => String(outcome.tokenId)),
    ["8", "2", "16", "32", "4"],
    "lowest-odds token selection"
  );
  passed.push("lowest-odds selection uses lowest payout");

  const manyOutcomePlan = buildDirectBuyAllOutcomesPlan(mockEventMarket({
    address: "0x0000000000000000000000000000000000000053",
    outcomes: Array.from({ length: 20 }, (_, index) => ({
      tokenId: (1n << BigInt(index)).toString(),
      name: `Outcome ${index + 1}`,
      payout: index + 1,
      price: 1 / (index + 1)
    }))
  }), testCfg);
  assertSelfTest(
    manyOutcomePlan.outcomes.length === 5 && manyOutcomePlan.selection?.availableOutcomeCount === 20,
    "markets with many outcomes should stay eligible while the configured selection count is respected"
  );
  passed.push("markets with more than 12 outcomes remain eligible");

  const noOddsPlan = buildDirectBuyAllOutcomesPlan(mockEventMarket({
    address: "0x0000000000000000000000000000000000000043",
    outcomes: tokenOrderOutcomes()
  }), testCfg);
  assertSelfTest(
    noOddsPlan.selection?.rankSource === "token_order",
    `expected token_order fallback, got ${noOddsPlan.selection?.rankSource}`
  );
  assertSelfTest(
    noOddsPlan.selection?.fallbackReason === "missing_complete_odds_data",
    `expected missing odds fallback, got ${noOddsPlan.selection?.fallbackReason}`
  );
  assertArrayEqual(
    noOddsPlan.outcomes.map((outcome) => String(outcome.tokenId)),
    ["1", "2", "4", "8", "16"],
    "token-order fallback selection"
  );
  passed.push("speed fallback selects token order when odds are missing");

  const priceMarkets = filterEventMarkets([mockEventMarket({
    address: "0x0000000000000000000000000000000000000044",
    question: "BTC price range - 8 Hours",
    curve: "0x495B31876c092c236d1b0Df5Cc953D45d41301F1",
    categories: ["Price"],
    tags: ["8 hour"]
  })], testCfg);
  assertSelfTest(priceMarkets.length === 0, "Price market filter should exclude BTC price range markets");
  passed.push("Price markets are excluded from Event Market bot");

  const baseStart = Date.now() + 60000;
  const testingMarket = mockEventMarket({
    address: "0x0000000000000000000000000000000000000048",
    question: "$GENIUS FDV by end of May 31st? (Testing)",
    startDate: new Date(baseStart).toISOString(),
    endDate: new Date(baseStart + 48 * 3600000).toISOString()
  });
  const testingMarkets = filterEventMarkets([testingMarket], testCfg);
  assertSelfTest(testingMarkets.length === 0, "Testing markets should be hard-excluded even when manual blocklists are unset");
  const testingCurveMarkets = filterEventMarkets([mockEventMarket({
    address: "0x0000000000000000000000000000000000000055",
    question: "$GENIUS FDV by end of May 31st?",
    curve: "0x46B3BE67Cbe3adE39AEFbcDFb7ef6d980672B976",
    startDate: new Date(baseStart).toISOString(),
    endDate: new Date(baseStart + 48 * 3600000).toISOString()
  })], testCfg);
  assertSelfTest(testingCurveMarkets.length === 0, "testingCurve markets should be hard-excluded even without Testing in the title");
  const powerLdaMarkets = filterEventMarkets([mockEventMarket({
    address: "0x0000000000000000000000000000000000000056",
    curve: "0xa59096C20022a9ec5d7691E0DcDc7D46776b1b3d",
    startDate: new Date(baseStart).toISOString(),
    endDate: new Date(baseStart + 48 * 3600000).toISOString()
  })], testCfg);
  assertSelfTest(powerLdaMarkets.length === 0, "powerLdaCurve markets should be hard-excluded");
  const unknownCurveMarkets = filterEventMarkets([mockEventMarket({
    address: "0x0000000000000000000000000000000000000057",
    curve: "0x1111111111111111111111111111111111111111",
    startDate: new Date(baseStart).toISOString(),
    endDate: new Date(baseStart + 48 * 3600000).toISOString()
  })], testCfg);
  assertSelfTest(unknownCurveMarkets.length === 0, "unknown curve markets should be hard-excluded");
  const normalManualMarket = mockEventMarket({
    address: "0x0000000000000000000000000000000000000054",
    question: "$GENIUS FDV by end of May 31st?",
    startDate: new Date(baseStart).toISOString(),
    endDate: new Date(baseStart + 48 * 3600000).toISOString()
  });
  assertSelfTest(
    filterEventMarkets([normalManualMarket], testCfg).length === 1,
    "Normal matching markets should not be excluded when manual blocklists are unset"
  );
  const manuallyBlockedMarkets = filterEventMarkets([testingMarket], {
    ...testCfg,
    marketQuestionBlocklist: ["Testing"]
  });
  assertSelfTest(manuallyBlockedMarkets.length === 0, "Configured question blocklist should exclude matching markets");
  const manuallyAddressBlockedMarkets = filterEventMarkets([normalManualMarket], {
    ...testCfg,
    marketAddressBlocklist: [normalManualMarket.address]
  });
  assertSelfTest(manuallyAddressBlockedMarkets.length === 0, "Configured address blocklist should exclude matching markets");
  const onchainOnlyMarkets = filterEventMarkets([mockEventMarket({
    address: "0x0000000000000000000000000000000000000049",
    categories: [],
    tags: ["onchain"],
    startDate: new Date(baseStart).toISOString(),
    endDate: new Date(baseStart + 48 * 3600000).toISOString()
  })], testCfg);
  assertSelfTest(onchainOnlyMarkets.length === 0, "Onchain-only markets should be excluded by default");
  assertSelfTest(
    shouldDeferOnchainOnlyForRestSafety({
      ...testCfg,
      eventBuyDelaySeconds: 20,
      requireRestBeforeBuy: true
    }, onchainOnlyMarkets[0] ?? mockEventMarket({
      address: "0x0000000000000000000000000000000000000051",
      categories: [],
      tags: ["onchain"],
      startDate: new Date(baseStart).toISOString(),
      endDate: new Date(baseStart + 48 * 3600000).toISOString()
    }), ["live"]),
    "delayed REST safety should defer onchain-only markets instead of marking them seen"
  );
  passed.push("testing, powerLda and unknown-curve markets are hard-excluded; manual blocklists are opt-in");

  const shortDurationMarkets = filterEventMarkets([mockEventMarket({
    address: "0x0000000000000000000000000000000000000045",
    startDate: new Date(baseStart).toISOString(),
    endDate: new Date(baseStart + (48 * 3600000) - 1).toISOString()
  })], testCfg);
  assertSelfTest(shortDurationMarkets.length === 0, "47.999h markets should be excluded");
  const exactDurationMarkets = filterEventMarkets([mockEventMarket({
    address: "0x0000000000000000000000000000000000000046",
    startDate: new Date(baseStart).toISOString(),
    endDate: new Date(baseStart + 48 * 3600000).toISOString()
  })], testCfg);
  assertSelfTest(exactDurationMarkets.length === 1, "48h markets should be allowed");
  passed.push("market duration filter allows >=48h only");

  const delayedStart = new Date(Date.now() + 1000).toISOString();
  const delayedWaitMs = msUntilAction(mockEventMarket({
    address: "0x0000000000000000000000000000000000000050",
    startDate: delayedStart
  }), {
    ...testCfg,
    eventBuyDelaySeconds: 20,
    prebroadcastMs: 0
  });
  assertSelfTest(
    delayedWaitMs > 19000 && delayedWaitMs <= 22000,
    `delayed buy should wait until open+delay, got ${delayedWaitMs}ms`
  );
  assertSelfTest(
    normalizeQuestionForComparison("Stripe Valuation, June 2026?") ===
      normalizeQuestionForComparison("Stripe Valuation, June 2026 ?"),
    "REST title comparison should ignore spacing and punctuation"
  );
  assertSelfTest(
    !normalizedQuestionMismatch("Stripe Valuation, June 2026?", "Stripe Valuation, June 2026 ?"),
    "REST safety should allow punctuation-only title differences"
  );
  assertSelfTest(
    Boolean(normalizedQuestionMismatch("Stripe Valuation, June 2026?", "Anthropic Valuation, June 2026?")),
    "REST safety should reject structurally different titles"
  );
  assertSelfTest(
    shouldPreSignFastTransactions({
      ...testCfg,
      preSignFastTx: true,
      dryRun: false,
      execute: true,
      eventBuyMode: "fast",
      eventBuyDelaySeconds: 20
    }, { nextNonce: 1000 }),
    "pre-sign capability should stay enabled during delayed safety mode"
  );
  assertSelfTest(
    !canPreSignPendingRecord({ ...testCfg, requireRestBeforeBuy: true }, { safetyReady: false }) &&
      canPreSignPendingRecord({ ...testCfg, requireRestBeforeBuy: true }, { safetyReady: true }),
    "REST safety should allow pre-sign only after the pending market is verified"
  );
  const restStatusOnlyCfg = {
    ...testCfg,
    requireRestBeforeBuy: false,
    requireRestStatus: ["live"],
    requireQuoteBeforeBuy: false,
    requireChainMintBeforeBuy: false
  };
  assertSelfTest(
    marketSafetyGateEnabled(restStatusOnlyCfg) &&
      !canPreSignPendingRecord(restStatusOnlyCfg, { safetyReady: false }) &&
      canPreSignPendingRecord(restStatusOnlyCfg, { safetyReady: true }),
    "Configured REST status should enable the same safety gate even when REQUIRE_REST_BEFORE_BUY is off"
  );
  assertSelfTest(
    canWaitForSafetyWindow({ ...testCfg, eventBuyDelaySeconds: 20 }, mockEventMarket({
      startDate: new Date(Date.now() - 19000).toISOString()
    })) &&
      !canWaitForSafetyWindow({ ...testCfg, eventBuyDelaySeconds: 20 }, mockEventMarket({
        startDate: new Date(Date.now() - 21000).toISOString()
      })),
    "REST safety waiting should end at the configured post-open delay"
  );
  const deadlineCfg = {
    ...testCfg,
    eventBuyDelaySeconds: 20,
    requireRestBeforeBuy: true,
    requireRestStatus: ["live"],
    stateFile: tempFile(`42space-rest-deadline-seen-${Date.now()}.json`),
    fillsFile: tempFile(`42space-rest-deadline-fills-${Date.now()}.jsonl`)
  };
  const deadlineMarket = mockEventMarket({
    address: "0x0000000000000000000000000000000000000055",
    startDate: new Date(Date.now() - 21000).toISOString()
  });
  const deadlineKey = eventSeenKey(deadlineMarket, deadlineCfg);
  const deadlineSeen = new Set();
  const deadlinePending = new Map([
    [deadlineKey, { market: deadlineMarket, safetyReady: false, restLastStatus: "not_started" }]
  ]);
  skipRestNotLiveAtActionDeadline(deadlineCfg, deadlineSeen, deadlinePending, "self-test");
  assertSelfTest(
    deadlineSeen.has(deadlineKey) && !deadlinePending.has(deadlineKey),
    "REST live deadline should skip pending markets that are not live at open+delay"
  );
  assertSelfTest(
    executionMarksSeen({ status: "broadcast", txHash: "0x42" }) &&
      !executionMarksSeen({ status: "broadcast" }),
    "broadcast should mark a market seen only after a tx hash exists"
  );
  passed.push("delayed safety mode prechecks REST and pre-signs only verified markets");

  const restPollCfg = {
    ...testCfg,
    eventBuyDelaySeconds: 20,
    requireRestBeforeBuy: true,
    requireRestStatus: ["live"],
    requireQuoteBeforeBuy: false,
    requireChainMintBeforeBuy: false,
    stateFile: tempFile(`42space-rest-poll-self-test-seen-${Date.now()}.json`),
    fillsFile: tempFile(`42space-rest-poll-self-test-fills-${Date.now()}.jsonl`)
  };
  const chainOnlyMarket = mockEventMarket({
    address: "0x0000000000000000000000000000000000000052",
    categories: [],
    tags: ["onchain"],
    startDate: new Date(Date.now() + 60000).toISOString(),
    endDate: new Date(Date.now() + 49 * 3600000).toISOString()
  });
  const restLiveMarket = {
    ...chainOnlyMarket,
    categories: ["Crypto"],
    tags: ["Normal"],
    status: "live"
  };
  const restPollSeen = new Set();
  const restPollPending = new Map([
    [eventSeenKey(chainOnlyMarket, restPollCfg), { market: chainOnlyMarket, preparedPlan: null, safetyReady: false }]
  ]);
  await refreshPendingRestSafetyFromRest(
    restPollCfg,
    restPollSeen,
    restPollPending,
    { receiverAddress: testCfg.walletAddress },
    [restLiveMarket],
    "self-test"
  );
  const restVerifiedRecord = restPollPending.get(eventSeenKey(chainOnlyMarket, restPollCfg));
  assertSelfTest(
    restVerifiedRecord?.safetyReady && restVerifiedRecord?.preparedPlan,
    "REST live polling should prepare an already pending on-chain market before buy time"
  );
  passed.push("REST polling upgrades pending on-chain markets before the buy deadline");

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "42space-self-test-"));
  try {
    const stateFile = path.join(stateDir, "seen.json");
    saveSeen(stateFile, new Set(["market-a", "market-b"]));
    assertSelfTest(loadSeen(stateFile).has("market-a"), "saved seen file should load");
    saveSeen(stateFile, new Set(["market-c"]));
    fs.writeFileSync(stateFile, "{ broken json", { mode: 0o600 });
    const recovered = loadSeen(stateFile);
    assertSelfTest(
      recovered.has("market-a") && recovered.has("market-b"),
      "corrupt seen file should recover from backup"
    );
    const notificationCfg = {
      ...testCfg,
      notificationStateFile: path.join(stateDir, "notifications.json"),
      stateFile: path.join(stateDir, "readonly-seen.json"),
      fillsFile: path.join(stateDir, "readonly-fills.jsonl"),
      pushPlusEnabled: false,
      pushPlusToken: ""
    };
    const notificationMarket = mockEventMarket({
      address: "0x0000000000000000000000000000000000000058"
    });
    assertSelfTest(
      notifyMarketDiscovered(notificationCfg, notificationMarket, null, "self-test") &&
        !notifyMarketDiscovered(notificationCfg, notificationMarket, null, "self-test"),
      "market discovery notifications should persistently dedupe by market"
    );
    assertSelfTest(
      loadSeen(notificationCfg.notificationStateFile).has(marketNotificationKey("discovered", notificationMarket)),
      "market discovery notification key should be persisted"
    );
    const readonlyWsMarket = mockEventMarket({
      address: "0x0000000000000000000000000000000000000059",
      categories: [],
      tags: ["onchain"],
      startDate: new Date(baseStart).toISOString(),
      endDate: new Date(baseStart + 49 * 3600000).toISOString()
    });
    handleFundingWaitWsMarkets({
      ...notificationCfg,
      allowOnchainOnlyMarkets: false
    }, [readonlyWsMarket], "self-test");
    assertSelfTest(
      loadSeen(notificationCfg.notificationStateFile).has(marketNotificationKey("discovered", readonlyWsMarket)),
      "funding wait WSS should persistently notify a chain-only candidate"
    );
    assertSelfTest(
      !fs.existsSync(notificationCfg.stateFile),
      "funding wait WSS should not mutate the buy seen state"
    );
    passed.push("seen and notification state writes are atomic; readonly WSS notifications persist without mutating buy state");
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  const sellNowMs = Date.now();
  const sellPosition = {
    marketAddress: "0x0000000000000000000000000000000000000047",
    tokenId: "8"
  };
  const sellRecord = {
    firstSeenAt: sellNowMs - 120000,
    marketStartAt: sellNowMs - 120000,
    peakProfitMultiple: 1.5,
    observations: [
      { at: sellNowMs - 90000, profitMultiple: 1.2 },
      { at: sellNowMs - 60000, profitMultiple: 1.5 },
      { at: sellNowMs - 30000, profitMultiple: 1.1 }
    ]
  };
  const sellCfg = {
    ...testCfg,
    autoSellOriginalEnabled: false,
    autoSellFixedTrailingEnabled: true,
    autoSellTrailingStartDelaySeconds: 30,
    autoSellTrailingArmProfitPct: 30,
    autoSellTrailingDrawdownPct: 25,
    autoSellTrailingPercent: 50,
    autoSellAdaptiveTrailingEnabled: false,
    autoSellWeakExitEnabled: false,
    autoSellBreakevenEnabled: true,
    autoSellBreakevenStartDelaySeconds: 30,
    autoSellBreakevenArmProfitPct: 30,
    autoSellBreakevenExitProfitPct: 3,
    autoSellBreakevenPercent: 100
  };
  const sellTriggers = autoSellTriggers(sellCfg, sellPosition, sellRecord, {
    walletAddress: testCfg.walletAddress,
    nowMs: sellNowMs,
    costBasisUsdt: 5,
    fullExitValueUsdt: 5.1,
    profitMultiple: 1.02
  });
  assertSelfTest(
    sellTriggers.some((trigger) => trigger.strategy === "fixed_trailing"),
    "fixed trailing exit should trigger after armed peak drawdown"
  );
  assertSelfTest(
    sellTriggers.some((trigger) => trigger.strategy === "breakeven"),
    "breakeven exit should trigger after armed profit falls back near cost"
  );
  assertSelfTest(
    chooseAutoSellTrigger(sellTriggers).strategy === "breakeven",
    "largest sell percent should win when multiple auto-sell strategies trigger"
  );

  const weakTriggers = autoSellTriggers({
    ...sellCfg,
    autoSellFixedTrailingEnabled: false,
    autoSellBreakevenEnabled: false,
    autoSellWeakExitEnabled: true,
    autoSellWeakExitAfterOpenSeconds: 60,
    autoSellWeakExitMinPeakProfitPct: 20,
    autoSellWeakExitMaxCurrentProfitPct: 10,
    autoSellWeakExitPercent: 100
  }, sellPosition, {
    ...sellRecord,
    peakProfitMultiple: 1.1
  }, {
    walletAddress: testCfg.walletAddress,
    nowMs: sellNowMs,
    costBasisUsdt: 5,
    fullExitValueUsdt: 5.25,
    profitMultiple: 1.05
  });
  assertSelfTest(
    weakTriggers.some((trigger) => trigger.strategy === "weak_exit"),
    "weak exit should trigger when required peak profit is not reached by deadline"
  );
  passed.push("auto-sell exits trigger per outcome and choose the strongest action");

  console.log(JSON.stringify({
    level: "event-self-test",
    passed: passed.length,
    checks: passed,
    at: new Date().toISOString()
  }, null, 2));
}

function mockEventMarket(overrides = {}) {
  const now = Date.now();
  return {
    address: "0x0000000000000000000000000000000000000042",
    question: "Self test Event Market",
    status: "live",
    createdAt: new Date(now).toISOString(),
    startDate: new Date(now + 60000).toISOString(),
    endDate: new Date(now + 3600000).toISOString(),
    contractVersion: 2,
    collateral: "0x55d398326f99059fF775485246999027B3197955",
    parentTokenId: "0",
    curve: "0xDC26047458FEa8Bd45164217CCb7eE90b9bE10B8",
    categories: ["Crypto"],
    tags: ["Normal"],
    outcomes: [
      { tokenId: "1", name: "A", payout: 6, price: 0.1667 },
      { tokenId: "2", name: "B", payout: 2, price: 0.5 },
      { tokenId: "4", name: "C", payout: 5, price: 0.2 },
      { tokenId: "8", name: "D", payout: 1, price: 1 },
      { tokenId: "16", name: "E", payout: 3, price: 0.3333 },
      { tokenId: "32", name: "F", payout: 4, price: 0.25 }
    ],
    ...overrides
  };
}

function tokenOrderOutcomes() {
  return [
    { tokenId: "1", name: "A" },
    { tokenId: "2", name: "B" },
    { tokenId: "4", name: "C" },
    { tokenId: "8", name: "D" },
    { tokenId: "16", name: "E" },
    { tokenId: "32", name: "F" }
  ];
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`Self-test failed: ${message}`);
}

function assertArrayEqual(actual, expected, label) {
  const same = actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  if (!same) {
    throw new Error(`Self-test failed: ${label}; expected ${expected.join(",")}, got ${actual.join(",")}`);
  }
}

async function buildPresignTestRecords(cfg, args) {
  const chain = await loadChainEventMarkets(cfg, args);
  const futureMarkets = chain.eventMarkets
    .filter((market) => msUntilStart(market) > 0)
    .sort(compareStartAsc);
  const startDate = args.startDate ?? futureMarkets[0]?.startDate;
  if (!startDate) throw new Error("No future Event Market found for pre-sign test");
  const startMs = new Date(startDate).getTime();
  const batch = futureMarkets.filter((market) => new Date(market.startDate).getTime() === startMs);
  if (batch.length <= 1) throw new Error(`Need at least 2 same-start Event Markets for bundle pre-sign test at ${startDate}`);

  const testCfg = {
    ...cfg,
    privateKey: PUBLIC_TEST_PRIVATE_KEY,
    dryRun: false,
    execute: true,
    riskAck: "YES",
    eligibilityAck: "YES",
    eventBuyMode: "fast",
    preSignFastTx: true
  };
  const runtime = { receiverAddress: PUBLIC_TEST_RECEIVER, nextNonce: 1000 };
  const records = await Promise.all(batch.map((market) => preparePendingRecord(testCfg, market, runtime)));
  const prepareErrors = records.filter((record) => record.prepareError).map((record) => ({
    market: pendingMarket(record).address,
    error: record.prepareError
  }));
  if (prepareErrors.length > 0) {
    throw new Error(`Pre-sign test prepare failed: ${JSON.stringify(prepareErrors)}`);
  }
  return { chain, batch, startDate, testCfg, runtime, records };
}

async function buy(cfg, args) {
  const eventPlan = await buildEventPlan(cfg, args);
  const result = await executeOrPrint(eventPlan, cfg, null);
  appendJsonl(cfg.fillsFile, {
    plan: describeEventPlan(eventPlan),
    result,
    at: new Date().toISOString()
  });
}

async function minimal(cfg, args) {
  cfg.stakePerOutcomeUsdt = Number(args.stakePerOutcomeUsdt ?? cfg.stakePerOutcomeUsdt);
  cfg.eventBuyMode = "fast";
  cfg.fastSkipPreflight = false;
  cfg.waitForReceipt = true;
  cfg.dryRun = true;
  cfg.execute = false;

  if (!cfg.privateKey) {
    cfg.privateKey = await promptHidden("PRIVATE_KEY (hidden): ");
  }
  if (!cfg.privateKey) throw new Error("PRIVATE_KEY is required");

  const eventPlan = await buildEventPlan(cfg, args);
  const status = await getWalletStatus(cfg);
  const described = describeEventPlan(eventPlan);
  console.log(JSON.stringify({
    level: "minimal-preview",
    wallet: {
      address: status.address,
      bnbBalance: status.bnbBalance,
      busdtBalance: status.busdtBalance,
      busdtAllowanceToRouter: status.busdtAllowanceToRouter
    },
    plan: described
  }, null, 2));

  await requireExactConfirmation(
    `Type BUY ELIGIBLE to approve if needed and buy ${eventPlan.outcomes.length} selected outcomes in "${eventPlan.market.question}" for ${eventPlan.stakePerOutcomeUsdt}U each, total ${eventPlan.totalStakeUsdt}U, and confirm you are not in a 42 restricted jurisdiction: `,
    "确认买入"
  );

  cfg.dryRun = false;
  cfg.execute = true;
  cfg.riskAck = "YES";
  cfg.eligibilityAck = "YES";

  const approval = await approveRouterMax(cfg, { requiredUsdt: eventPlan.totalStakeUsdt });
  console.log(JSON.stringify({ level: "minimal-approval", approval }, null, 2));

  const runtime = await createRuntime(cfg);
  const result = await buyOutcomesBatch(cfg, eventPlan, runtime);
  appendJsonl(cfg.fillsFile, {
    plan: described,
    result,
    at: new Date().toISOString()
  });
  console.log(JSON.stringify({ level: "minimal-executed", plan: described, result }, null, 2));
}

async function arm(cfg, args) {
  cfg.stakePerOutcomeUsdt = Number(args.stakePerOutcomeUsdt ?? cfg.stakePerOutcomeUsdt);
  cfg.eventBuyMode = "fast";
  cfg.dryRun = false;
  cfg.execute = true;
  cfg.riskAck = "YES";
  cfg.eligibilityAck = "YES";
  cfg.fastSkipPreflight = true;

  if (!cfg.privateKey) {
    cfg.privateKey = await promptHidden("PRIVATE_KEY for long-running event:watch (hidden): ");
  }
  if (!cfg.privateKey) throw new Error("PRIVATE_KEY is required for event:arm");

  console.log(JSON.stringify({
    level: "event-arm",
    mode: "execute",
    eventDiscovery: cfg.eventDiscovery,
    wsProvider: wsProviderLabel(cfg.wsUrl),
    eventBuyMode: cfg.eventBuyMode,
    restDiscoveryEnabled: cfg.restDiscoveryEnabled,
    restDiscoveryPollMs: cfg.restDiscoveryPollMs,
    stakePerOutcomeUsdt: cfg.stakePerOutcomeUsdt,
    eventOutcomeSelection: cfg.eventOutcomeSelection,
    eventOutcomeCount: cfg.eventOutcomeCount,
    eventOutcomeSelectionFallback: cfg.eventOutcomeSelectionFallback,
    marketAddressBlocklist: cfg.marketAddressBlocklist,
    marketQuestionBlocklist: cfg.marketQuestionBlocklist,
    allowOnchainOnlyMarkets: cfg.allowOnchainOnlyMarkets,
    maxMarketStakeUsdt: cfg.maxMarketStakeUsdt,
    maxBatchStakeUsdt: cfg.maxBatchStakeUsdt,
    fastSkipPreflight: cfg.fastSkipPreflight,
    fastSkipDueRestHydration: cfg.fastSkipDueRestHydration,
    waitForReceipt: cfg.waitForReceipt,
    fanoutBroadcast: cfg.fanoutBroadcast,
    broadcastRpcCount: cfg.broadcastRpcUrls.length,
    executionRetryMs: cfg.executionRetryMs,
    eventOpenWindowSeconds: cfg.eventOpenWindowSeconds,
    eventBuyDelaySeconds: cfg.eventBuyDelaySeconds,
    requireRestBeforeBuy: cfg.requireRestBeforeBuy,
    requireRestStatus: cfg.requireRestStatus,
    requireQuoteBeforeBuy: cfg.requireQuoteBeforeBuy,
    requireChainMintBeforeBuy: cfg.requireChainMintBeforeBuy,
    preSignFastTx: cfg.preSignFastTx,
    preSignWindowMs: cfg.preSignWindowMs,
    preSignRetryMs: cfg.preSignRetryMs,
    armWaitForFunding: cfg.armWaitForFunding,
    armFundingRetryMs: cfg.armFundingRetryMs,
    armFundingHotRetryMs: cfg.armFundingHotRetryMs,
    armFundingHotWindowMs: cfg.armFundingHotWindowMs,
    armCatchUpAfterFunding: cfg.armCatchUpAfterFunding,
    armCatchUpWindowMs: cfg.armCatchUpWindowMs,
    autoSellEnabled: cfg.autoSellEnabled,
    autoSellProfitMultiplier: cfg.autoSellProfitMultiplier,
    autoSellPercent: cfg.autoSellPercent,
    autoSellPollMs: cfg.autoSellPollMs,
    autoSellMinOutMode: cfg.autoSellMinOutMode,
    autoSellManualMinOutUsdt: cfg.autoSellManualMinOutUsdt,
    note: "private key is held only in this process; it is not written to disk"
  }, null, 2));

  let fundingRecovery = null;
  let fundingWaitAutoSellMonitor = null;
  let fundingWaitDiscoveryMonitor = null;
  let fundingWaitWsDiscoveryMonitor = null;
  if (cfg.armWaitForFunding) {
    const waitingSince = Date.now();
    fundingWaitAutoSellMonitor = startAutoSellMonitor(cfg, null);
    fundingWaitDiscoveryMonitor = startFundingWaitDiscoveryMonitor(cfg);
    fundingWaitWsDiscoveryMonitor = startFundingWaitWsDiscoveryMonitor(cfg);
    const fundingStatus = await waitForWatchFunding(cfg, {
      autoSellMonitor: fundingWaitAutoSellMonitor,
      fundingWaitWsDiscoveryMonitor
    });
    if (fundingWaitAutoSellMonitor) {
      clearInterval(fundingWaitAutoSellMonitor);
      fundingWaitAutoSellMonitor = null;
    }
    if (fundingWaitDiscoveryMonitor) {
      clearInterval(fundingWaitDiscoveryMonitor);
      fundingWaitDiscoveryMonitor = null;
    }
    if (fundingWaitWsDiscoveryMonitor) {
      fundingWaitWsDiscoveryMonitor.stop();
      fundingWaitWsDiscoveryMonitor = null;
    }
    fundingRecovery = {
      enabled: cfg.armCatchUpAfterFunding,
      waitingSince,
      fundingReadyAt: Date.now(),
      fundingStatus
    };
  }

  await watch(cfg, { fundingRecovery });
}

async function preflight(cfg) {
  const { publicClient } = makeClients(cfg);
  const status = await getWalletStatus(cfg);
  const [chain, restFutureMarkets] = await Promise.all([
    loadChainEventMarkets(cfg, { lookbackBlocks: cfg.eventLogLookbackBlocks }),
    loadUpcomingRestEventMarkets(cfg)
  ]);
  const funding = computeFundingRequirement(cfg, mergeMarketLists(chain.eventMarkets, restFutureMarkets));
  const [gasReserve, minimumGasReserve] = await Promise.all([
    estimateFastGasReserve(publicClient, cfg, funding),
    estimateFastGasReserve(publicClient, cfg, minimumExecutionFunding(funding))
  ]);
  const readiness = walletFundingReadiness(status, funding, gasReserve, minimumGasReserve);
  console.log(
    JSON.stringify(
      {
        level: "wallet-preflight",
        status,
        funding,
        gasReserve,
        minimumGasReserve,
        ...readiness
      },
      null,
      2
    )
  );
}

async function approve(cfg, args = {}) {
  const amountUsdt = args.amountUsdt ?? args.amount ?? args.allowance ?? null;
  const result = amountUsdt
    ? await approveRouterAmount(cfg, { amountUsdt })
    : await approveRouterMax(cfg, { requiredUsdt: cfg.maxMarketStakeUsdt });
  console.log(JSON.stringify({ level: "router-approval", result }, null, 2));
}

async function operatorApprove(cfg, args = {}) {
  if (!args.market) throw new Error("operator-approve requires --market");
  if (!cfg.dryRun && cfg.execute && !cfg.privateKey) {
    cfg.privateKey = await promptHidden("PRIVATE_KEY for operator approval (hidden): ");
  }
  const { account } = makeClients(cfg);
  const walletAddress = args.wallet ?? cfg.walletAddress ?? account?.address;
  if (!walletAddress) throw new Error("operator-approve requires --wallet, WALLET_ADDRESS, or PRIVATE_KEY");
  if (!cfg.dryRun && cfg.execute && account && walletAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Real operator approval wallet must match PRIVATE_KEY-derived address");
  }
  const result = await approveMarketOperator(cfg, {
    market: args.market,
    owner: walletAddress
  });
  console.log(JSON.stringify({
    level: "operator-approval",
    mode: cfg.dryRun || !cfg.execute ? "dry-run" : "execute",
    wallet: walletAddress,
    result
  }, null, 2));
}

async function doctor(cfg, args = {}) {
  const { publicClient, account } = makeClients(cfg);
  let funding = computeFundingRequirement(cfg, []);
  let gasReserve = null;
  let chainFundingSource = null;
  let chainFundingError = null;
  try {
    const chain = await loadChainEventMarkets(cfg, { lookbackBlocks: cfg.eventLogLookbackBlocks });
    funding = computeFundingRequirement(cfg, chain.eventMarkets);
    chainFundingSource = {
      head: chain.head,
      fromBlock: chain.fromBlock,
      controllerLogs: chain.controllerLogs,
      eventMarkets: chain.eventMarkets.length,
      decodeErrors: chain.decodeErrors.length
    };
  } catch (error) {
    chainFundingError = errorMessage(error);
  }
  try {
    gasReserve = await estimateFastGasReserve(publicClient, cfg, funding);
  } catch (error) {
    gasReserve = { ok: false, message: errorMessage(error) };
  }
  const checks = {
    config: {
      dryRun: cfg.dryRun,
      execute: cfg.execute,
      privateKeyPresent: Boolean(cfg.privateKey),
      riskAck: cfg.riskAck === "YES",
      eligibilityAck: cfg.eligibilityAck === "YES",
      eventBuyMode: cfg.eventBuyMode,
      eventDiscovery: cfg.eventDiscovery,
      wsProvider: wsProviderLabel(cfg.wsUrl),
      watchFundingMode: cfg.watchFundingMode,
      bundleDueMarkets: cfg.bundleDueMarkets,
      fastSkipPreflight: cfg.fastSkipPreflight,
      fastSkipDueRestHydration: cfg.fastSkipDueRestHydration,
      fanoutBroadcast: cfg.fanoutBroadcast,
      broadcastRpcCount: cfg.broadcastRpcUrls.length,
      preSignFastTx: cfg.preSignFastTx,
      preSignWindowMs: cfg.preSignWindowMs,
      preSignRetryMs: cfg.preSignRetryMs,
      nonceSyncBeforePreSign: cfg.nonceSyncBeforePreSign,
      nonceSyncMinIntervalMs: cfg.nonceSyncMinIntervalMs,
      waitForReceipt: cfg.waitForReceipt,
      asyncReceiptWatch: cfg.asyncReceiptWatch,
      receiptWatchTimeoutMs: cfg.receiptWatchTimeoutMs,
      receiptWatchPollingMs: cfg.receiptWatchPollingMs,
      executionRetryMs: cfg.executionRetryMs,
      stakePerOutcomeUsdt: cfg.stakePerOutcomeUsdt,
      eventOutcomeSelection: cfg.eventOutcomeSelection,
      eventOutcomeCount: cfg.eventOutcomeCount,
      eventOutcomeSelectionFallback: cfg.eventOutcomeSelectionFallback,
      maxBatchStakeUsdt: cfg.maxBatchStakeUsdt,
      requiredBusdt: funding.requiredBusdt,
      requiredBusdtUpperBound: funding.upperBoundRequiredBusdt
    },
    funding,
    gasReserve,
    chainFundingSource,
    docs: {
      restTradingApi: "not documented; contract route required",
      chainId: 56
    },
    rpc: await checkRpc(publicClient),
    broadcastRpc: await warmBroadcastRpcClients(cfg),
    ws: cfg.eventDiscovery === "ws" ? await checkWs(cfg) : { skipped: true },
    wallet: null,
    latestEventPlan: null,
    blockers: []
  };

  const walletAddress = args.wallet ?? cfg.walletAddress ?? account?.address;
  if (walletAddress) {
    try {
      const status = await getWalletStatusForAddress(publicClient, walletAddress);
      checks.wallet = {
        address: status.address,
        readOnly: !account || status.address.toLowerCase() !== account.address.toLowerCase(),
        bnbBalance: status.bnbBalance,
        busdtBalance: status.busdtBalance,
        busdtAllowanceToRouter: status.busdtAllowanceToRouter,
        router: status.router,
        allowanceReady: Number(status.busdtAllowanceToRouter) >= funding.requiredBusdt,
        balanceReady: Number(status.busdtBalance) >= funding.requiredBusdt,
        bnbReady: gasReserve?.requiredBnb ? Number(status.bnbBalance) >= Number(gasReserve.requiredBnb) : null,
        allowanceReadyForUpperBound: Number(status.busdtAllowanceToRouter) >= funding.upperBoundRequiredBusdt,
        balanceReadyForUpperBound: Number(status.busdtBalance) >= funding.upperBoundRequiredBusdt
      };
    } catch (error) {
      checks.wallet = { ok: false, message: errorMessage(error) };
    }
  }
  if (!cfg.privateKey) checks.blockers.push("PRIVATE_KEY is not loaded from .env/.env.local/secrets; event:arm will prompt for it interactively");

  if (!cfg.dryRun && !cfg.execute) checks.blockers.push("EXECUTE=1 is required when DRY_RUN=0");
  if (!cfg.dryRun && cfg.riskAck !== "YES") checks.blockers.push("I_UNDERSTAND_42_PRICE_MARKET_RISK=YES is required");
  if (!cfg.dryRun && cfg.eligibilityAck !== "YES") checks.blockers.push("I_AM_NOT_IN_RESTRICTED_JURISDICTION=YES is required");
  if (chainFundingError) checks.blockers.push(`Could not compute next-batch funding from chain logs: ${chainFundingError}`);
  if (gasReserve?.ok === false) checks.blockers.push(`Could not estimate fast gas reserve: ${gasReserve.message}`);
  if (checks.wallet && checks.wallet.allowanceReady === false) checks.blockers.push("BUSDT allowance is below required next buy batch; run event:approve");
  if (checks.wallet && checks.wallet.balanceReady === false) checks.blockers.push("BUSDT balance is below required next buy batch");
  if (checks.wallet && checks.wallet.bnbReady === false) checks.blockers.push("BNB balance is below required fast gas reserve");

  try {
    const eventPlan = await buildEventPlan(cfg, { forceQuoted: false });
    checks.latestEventPlan = describeEventPlan(eventPlan);
  } catch (error) {
    checks.latestEventPlan = { ok: false, message: errorMessage(error) };
    checks.blockers.push("No buildable latest Event Market plan");
  }

  console.log(JSON.stringify({ level: "event-doctor", checks }, null, 2));
}

async function checkRpc(publicClient) {
  try {
    const [blockNumber, gasPrice] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getGasPrice()
    ]);
    return {
      ok: true,
      blockNumber: blockNumber.toString(),
      gasPriceWei: gasPrice.toString()
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

async function checkWs(cfg) {
  if (!cfg.doctorCheckWs) {
    return {
      skipped: true,
      configured: Boolean(cfg.wsUrl),
      url: redactSecretUrls(cfg.wsUrl),
      note: "set DOCTOR_CHECK_WS=1 to open a live WSS check"
    };
  }

  try {
    const blockNumber = await getWsBlockNumberOnce(cfg.wsUrl, 2500);
    return {
      ok: true,
      blockNumber: blockNumber.toString(),
      url: redactSecretUrls(cfg.wsUrl)
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error), url: redactSecretUrls(cfg.wsUrl) };
  }
}

function getWsBlockNumberOnce(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let finished = false;
    const timer = setTimeout(() => finish(new Error("WSS blockNumber timeout")), timeoutMs);

    function finish(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        socket.close();
        socket.terminate?.();
      } catch {
        // best-effort close for one-shot doctor checks.
      }
      if (error) reject(error);
      else resolve(value);
    }

    socket.on("open", () => {
      socket.send(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: []
      }));
    });
    socket.on("message", (data) => {
      try {
        const parsed = JSON.parse(String(data));
        if (parsed.error) {
          finish(new Error(parsed.error.message ?? JSON.stringify(parsed.error)));
          return;
        }
        finish(null, BigInt(parsed.result));
      } catch (error) {
        finish(error);
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("WSS closed before blockNumber response")));
  });
}

async function createRuntime(cfg) {
  if (cfg.dryRun || !cfg.execute || cfg.eventBuyMode !== "fast") return null;
  const { publicClient, account } = makeClients(cfg);
  if (!account) return null;
  const runtime = {
    receiverAddress: cfg.walletAddress || account.address
  };
  if (cfg.fastNonceManager) {
    runtime.nextNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending"
    });
  }
  return runtime;
}

async function watch(cfg, options = {}) {
  const seen = loadSeen(cfg.stateFile);
  const watchPreflight = await validateWatchFunding(cfg);
  const broadcastWarmup = await maybeWarmBroadcastRpcs(cfg);
  const runtime = await createRuntime(cfg);
  const autoSellMonitor = startAutoSellMonitor(cfg, runtime);
  const initialPending = new Map();
  const startupWarnings = [];
  const wsStartupSeedDeferred = cfg.eventDiscovery === "ws" && !cfg.watchBuyExisting;

  if (!wsStartupSeedDeferred) {
    startupWarnings.push(...(await seedStartupMarkets(cfg, seen, initialPending, runtime, options)));
  }

  const runtimeStatus = buildWatchRuntimeStatus(cfg, {
    runtime,
    watchPreflight,
    broadcastWarmup,
    startupWarnings,
    wsStartupSeedDeferred,
    fundingRecovery: options.fundingRecovery,
    autoSellMonitor
  });
  writeRuntimeStatusFile(cfg, runtimeStatus);
  console.log(JSON.stringify(runtimeStatus, null, 2));

  if (cfg.eventDiscovery === "ws") {
    await watchWs(cfg, seen, runtime, initialPending, {
      seedStartup: wsStartupSeedDeferred,
      fundingRecovery: options.fundingRecovery
    });
    return;
  }
  if (cfg.eventDiscovery === "chain") {
    await watchChain(cfg, seen, runtime, initialPending);
    return;
  }

  await watchRest(cfg, seen, runtime, initialPending);
}

function buildWatchRuntimeStatus(cfg, {
  runtime = null,
  watchPreflight = null,
  broadcastWarmup = null,
  startupWarnings = [],
  wsStartupSeedDeferred = false,
  fundingRecovery = null,
  autoSellMonitor = null,
  fundingWaitWsDiscoveryMonitor = null,
  phase = "watching"
} = {}) {
  const autoSellRuntimeEnabled = Boolean(
    autoSellMonitor || (phase === "waiting_for_funds" && cfg.autoSellEnabled && hasAutoSellStrategyEnabled(cfg))
  );
  return {
    level: "watch-runtime",
    command: process.argv[2] ?? "watch",
    pid: process.pid,
    startedAt: PROCESS_STARTED_AT,
    phase,
    mode: cfg.dryRun || !cfg.execute ? "dry-run" : "execute",
    walletAddress: cfg.walletAddress || runtime?.receiverAddress || null,
    configSources: runtimeConfigSources(cfg),
    dataSources: {
      restApi: wsProviderLabel(cfg.restUrl),
      primaryRpc: wsProviderLabel(cfg.rpcUrl),
      wsProvider: wsProviderLabel(cfg.wsUrl),
      eventDiscovery: cfg.eventDiscovery,
      restDiscoveryEnabled: cfg.restDiscoveryEnabled,
      restDiscoveryPollMs: cfg.restDiscoveryPollMs,
      broadcastRpcCount: cfg.broadcastRpcUrls.length,
      broadcastRpcProviders: cfg.broadcastRpcUrls.map(wsProviderLabel)
    },
    strategy: {
      eventBuyMode: cfg.eventBuyMode,
      eventOutcomeSelection: cfg.eventOutcomeSelection,
      eventOutcomeCount: cfg.eventOutcomeCount,
      eventOutcomeSelectionFallback: cfg.eventOutcomeSelectionFallback,
      stakePerOutcomeUsdt: cfg.stakePerOutcomeUsdt,
      maxMarketStakeUsdt: cfg.maxMarketStakeUsdt,
      maxBatchStakeUsdt: cfg.maxBatchStakeUsdt,
      minMarketDurationHours: cfg.minMarketDurationHours,
      marketAddressBlocklist: cfg.marketAddressBlocklist,
      marketQuestionBlocklist: cfg.marketQuestionBlocklist,
      allowOnchainOnlyMarkets: cfg.allowOnchainOnlyMarkets,
      watchBuyExisting: cfg.watchBuyExisting,
      watchScanLimit: cfg.watchScanLimit,
      eventOpenWindowSeconds: cfg.eventOpenWindowSeconds,
      eventBuyDelaySeconds: cfg.eventBuyDelaySeconds,
      requireRestBeforeBuy: cfg.requireRestBeforeBuy,
      requireRestStatus: cfg.requireRestStatus,
      requireQuoteBeforeBuy: cfg.requireQuoteBeforeBuy,
      requireChainMintBeforeBuy: cfg.requireChainMintBeforeBuy
    },
    execution: {
      fastSkipPreflight: cfg.fastSkipPreflight,
      fastSkipDueRestHydration: cfg.fastSkipDueRestHydration,
      waitForReceipt: cfg.waitForReceipt,
      gasPriceGwei: cfg.gasPriceGwei || null,
      sellGasPriceGwei: cfg.sellGasPriceGwei || null,
      operatorApproveGasPriceGwei: cfg.operatorApproveGasPriceGwei || null,
      fastGasLimit: cfg.fastGasLimit || null,
      bundleFastGasLimit: cfg.bundleFastGasLimit || null,
      logChunkBlocks: cfg.logChunkBlocks,
      bundleDueMarkets: cfg.bundleDueMarkets,
      fastNonceManager: cfg.fastNonceManager,
      preSignFastTx: cfg.preSignFastTx,
      preSignWindowMs: cfg.preSignWindowMs,
      preSignRetryMs: cfg.preSignRetryMs,
      nonceSyncBeforePreSign: cfg.nonceSyncBeforePreSign,
      nonceSyncMinIntervalMs: cfg.nonceSyncMinIntervalMs,
      nextNonce: runtime?.nextNonce ?? null,
      asyncReceiptWatch: cfg.asyncReceiptWatch,
      receiptWatchTimeoutMs: cfg.receiptWatchTimeoutMs,
      receiptWatchPollingMs: cfg.receiptWatchPollingMs,
      executionRetryMs: cfg.executionRetryMs,
      pollMs: cfg.pollMs,
      hotPollMs: cfg.hotPollMs,
      preopenHotMs: cfg.preopenHotMs,
      prebroadcastMs: cfg.prebroadcastMs,
      wsReceiptFallbackMs: cfg.wsReceiptFallbackMs,
      wsReceiptFallbackRetries: cfg.wsReceiptFallbackRetries,
      receiverReady: Boolean(runtime?.receiverAddress || cfg.walletAddress)
    },
    autoSell: autoSellRuntimeEnabled
      ? {
          enabled: true,
          monitorActive: Boolean(autoSellMonitor),
          originalEnabled: cfg.autoSellOriginalEnabled,
          profitMultiplier: cfg.autoSellProfitMultiplier,
          percent: cfg.autoSellPercent,
          fixedTrailing: {
            enabled: cfg.autoSellFixedTrailingEnabled,
            startDelaySeconds: cfg.autoSellTrailingStartDelaySeconds,
            armProfitPct: cfg.autoSellTrailingArmProfitPct,
            drawdownPct: cfg.autoSellTrailingDrawdownPct,
            percent: cfg.autoSellTrailingPercent
          },
          adaptiveTrailing: {
            enabled: cfg.autoSellAdaptiveTrailingEnabled,
            startDelaySeconds: cfg.autoSellAdaptiveStartDelaySeconds,
            armProfitPct: cfg.autoSellAdaptiveArmProfitPct,
            earlySeconds: cfg.autoSellAdaptiveEarlySeconds,
            earlyDrawdownPct: cfg.autoSellAdaptiveEarlyDrawdownPct,
            windowSeconds: cfg.autoSellAdaptiveWindowSeconds,
            minSamples: cfg.autoSellAdaptiveMinSamples,
            smallJumpPct: cfg.autoSellAdaptiveSmallJumpPct,
            smallRangePct: cfg.autoSellAdaptiveSmallRangePct,
            smallDrawdownPct: cfg.autoSellAdaptiveSmallDrawdownPct,
            normalDrawdownPct: cfg.autoSellAdaptiveNormalDrawdownPct,
            largeJumpPct: cfg.autoSellAdaptiveLargeJumpPct,
            largeRangePct: cfg.autoSellAdaptiveLargeRangePct,
            largeDrawdownPct: cfg.autoSellAdaptiveLargeDrawdownPct,
            percent: cfg.autoSellAdaptivePercent
          },
          weakExit: {
            enabled: cfg.autoSellWeakExitEnabled,
            afterOpenSeconds: cfg.autoSellWeakExitAfterOpenSeconds,
            minPeakProfitPct: cfg.autoSellWeakExitMinPeakProfitPct,
            maxCurrentProfitPct: cfg.autoSellWeakExitMaxCurrentProfitPct,
            percent: cfg.autoSellWeakExitPercent
          },
          breakeven: {
            enabled: cfg.autoSellBreakevenEnabled,
            startDelaySeconds: cfg.autoSellBreakevenStartDelaySeconds,
            armProfitPct: cfg.autoSellBreakevenArmProfitPct,
            exitProfitPct: cfg.autoSellBreakevenExitProfitPct,
            percent: cfg.autoSellBreakevenPercent
          },
          pollMs: cfg.autoSellPollMs,
          minOutMode: cfg.autoSellMinOutMode,
          manualMinOutUsdt: cfg.autoSellManualMinOutUsdt
        }
      : { enabled: false },
    watchPreflight,
    broadcastWarmup,
    startupWarnings,
    wsStartupSeedDeferred,
    fundingRecovery: describeFundingRecovery(fundingRecovery),
    fundingWaitMonitoring: phase === "waiting_for_funds"
      ? {
          restReadonly: Boolean(cfg.pushPlusEnabled && cfg.pushPlusToken),
          wsReadonly: Boolean(fundingWaitWsDiscoveryMonitor)
        }
      : null
  };
}

function runtimeConfigSources(cfg) {
  return {
    dotenvLocal: runtimeFileSource(".env.local"),
    dotenv: runtimeFileSource(".env"),
    providerEnv: runtimeFileSource(path.join(os.homedir(), ".codex/secrets/evm-rpc-providers.env")),
    botConfigFile: runtimeFileSource(process.env.BOT_CONFIG_FILE ?? ""),
    runtimeStatusFile: path.resolve(cfg.runtimeStatusFile)
  };
}

function runtimeFileSource(file) {
  if (!file) return null;
  const resolved = path.resolve(file);
  return {
    path: resolved,
    exists: fs.existsSync(resolved)
  };
}

function writeRuntimeStatusFile(cfg, status) {
  if (!cfg.runtimeStatusFile) return;
  try {
    const file = path.resolve(cfg.runtimeStatusFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (error) {
    console.warn(JSON.stringify({ level: "runtime-status-write-error", message: errorMessage(error) }));
  }
}

function writeFundingWaitRuntimeStatus(cfg, fundingStatus = null, extras = {}) {
  writeRuntimeStatusFile(cfg, buildWatchRuntimeStatus(cfg, {
    watchPreflight: fundingStatus,
    phase: "waiting_for_funds",
    ...extras
  }));
}

async function maybeWarmBroadcastRpcs(cfg) {
  if (cfg.dryRun || !cfg.execute) {
    return { skipped: true, reason: "dry-run" };
  }
  return warmBroadcastRpcClients(cfg);
}

function startAutoSellMonitor(cfg, runtime = null) {
  if (!cfg.autoSellEnabled || !hasAutoSellStrategyEnabled(cfg)) return null;
  const seen = loadSeen(cfg.autoSellStateFile);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runAutoSellOnce(cfg, {
        seen,
        runtime,
        source: "monitor"
      });
      if (result.triggered > 0 || result.errors.length > 0) {
        console.log(JSON.stringify({
          level: "event-auto-sell-monitor",
          mode: cfg.dryRun || !cfg.execute ? "dry-run" : "execute",
          ...result
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: "event-auto-sell-error",
        source: "monitor",
        message: errorMessage(error),
        at: new Date().toISOString()
      }));
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, cfg.autoSellPollMs);
  void tick();
  return timer;
}

function startFundingWaitDiscoveryMonitor(cfg) {
  if (!cfg.pushPlusEnabled || !cfg.pushPlusToken) return null;
  let running = false;
  let initialized = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const markets = await loadRestDiscoveryEventMarkets(cfg);
      let alerted = 0;
      let seededLive = 0;
      for (const market of markets) {
        const key = marketNotificationKey("discovered", market);
        if (fundingWaitDiscoveryNotifications.has(key) || hasPersistentMarketNotification(cfg, key)) continue;
        fundingWaitDiscoveryNotifications.add(key);
        if (!initialized && msUntilStart(market) <= 0) {
          rememberPersistentMarketNotification(cfg, key);
          seededLive += 1;
          continue;
        }
        if (notifyMarketDiscovered(cfg, market, null, "funding-wait-rest-readonly")) alerted += 1;
      }
      if (alerted > 0 || seededLive > 0) {
        console.log(JSON.stringify({
          level: "event-funding-wait-discovery",
          alerted,
          seededLive,
          tracked: fundingWaitDiscoveryNotifications.size,
          at: new Date().toISOString()
        }));
      }
      initialized = true;
    } catch (error) {
      console.error(JSON.stringify({
        level: "warn",
        source: "funding-wait-rest-discovery",
        message: errorMessage(error),
        at: new Date().toISOString()
      }));
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, Math.max(250, cfg.restDiscoveryPollMs));
  void tick();
  return timer;
}

function startFundingWaitWsDiscoveryMonitor(cfg) {
  if (!cfg.pushPlusEnabled || !cfg.pushPlusToken || !cfg.wsUrl) return null;
  const { publicClient } = makeClients(cfg);
  const queue = [];
  const txBuffers = new Map();
  let unwatch = null;
  let running = false;
  let stopped = false;
  let reconnectAfterMs = 0;

  const disconnect = () => {
    const stopWatching = unwatch;
    unwatch = null;
    try {
      stopWatching?.();
    } catch {
      // The transport is already unavailable.
    }
  };

  const connect = () => {
    if (stopped || unwatch || Date.now() < reconnectAfterMs) return;
    try {
      const wsClient = makeWsClient(cfg);
      unwatch = watchControllerLogs(wsClient, {
        onLogs: (logs) => {
          queue.push(...logs);
          void tick();
        },
        onError: (error) => {
          disconnect();
          reconnectAfterMs = Date.now() + cfg.watchStartupRetryMs;
          console.error(JSON.stringify({
            level: "warn",
            source: "funding-wait-ws-readonly",
            message: errorMessage(error),
            retryInMs: cfg.watchStartupRetryMs,
            at: new Date().toISOString()
          }));
        }
      });
      console.log(JSON.stringify({
        level: "funding-wait-ws-readonly",
        status: "watching",
        url: redactSecretUrls(cfg.wsUrl),
        at: new Date().toISOString()
      }));
    } catch (error) {
      reconnectAfterMs = Date.now() + cfg.watchStartupRetryMs;
      console.error(JSON.stringify({
        level: "warn",
        source: "funding-wait-ws-readonly-startup",
        message: errorMessage(error),
        retryInMs: cfg.watchStartupRetryMs,
        at: new Date().toISOString()
      }));
    }
  };

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      connect();
      while (queue.length > 0) addBufferedControllerLog(txBuffers, queue.shift());
      await drainFundingWaitWsLogBuffers(publicClient, txBuffers, cfg);
    } catch (error) {
      console.error(JSON.stringify({
        level: "warn",
        source: "funding-wait-ws-readonly-drain",
        message: errorMessage(error),
        at: new Date().toISOString()
      }));
    } finally {
      running = false;
    }
  }

  connect();
  const timer = setInterval(() => void tick(), Math.max(25, Math.min(250, cfg.hotPollMs)));
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      disconnect();
    }
  };
}

async function runAutoSellOnce(cfg, { seen = loadSeen(cfg.autoSellStateFile), runtime = null, source = "manual" } = {}) {
  const { publicClient, account } = makeClients(cfg);
  const walletAddress = cfg.walletAddress || account?.address;
  if (!walletAddress) throw new Error("AUTO_SELL requires WALLET_ADDRESS or PRIVATE_KEY-derived account");
  if (!cfg.dryRun && cfg.execute && !account) throw new Error("PRIVATE_KEY is required for real AUTO_SELL");
  const result = {
    source,
    wallet: walletAddress,
    checked: 0,
    alreadyHandled: 0,
    triggered: 0,
    executed: 0,
    skipped: 0,
    errors: [],
    actions: []
  };
  if (!cfg.autoSellEnabled || !hasAutoSellStrategyEnabled(cfg)) return result;

  const positionState = loadAutoSellPositionState(cfg.autoSellPositionStateFile);
  const marketCache = new Map();
  const openPositions = await fetchOpenPositions(cfg, {
    user: walletAddress,
    limit: cfg.autoSellPositionLimit
  });
  let stateChanged = false;

  for (const position of openPositions) {
    if (!isAutoSellablePosition(position)) {
      result.skipped += 1;
      continue;
    }

    result.checked += 1;
    try {
      const nowMs = Date.now();
      const fullQuote = await quoteSellOutcome(publicClient, {
        market: position.marketAddress,
        tokenId: position.tokenId,
        owner: walletAddress,
        percent: 100,
        slippageBps: cfg.slippageBps
      });
      const costBasisUsdt = Number(position.costBasis ?? 0);
      const fullExitValueUsdt = rawUsdt(fullQuote.expectedCollateralToUser);
      const profitMultiple = costBasisUsdt > 0 ? fullExitValueUsdt / costBasisUsdt : 0;
      const stateKey = autoSellPositionKey(walletAddress, position);
      const marketStartMs = await resolvePositionMarketStartMs(cfg, position, marketCache, positionState.positions[stateKey]);
      const record = updateAutoSellPositionRecord(positionState, stateKey, {
        nowMs,
        marketStartMs,
        costBasisUsdt,
        fullExitValueUsdt,
        profitMultiple
      });
      stateChanged = true;

      const summary = {
        marketAddress: position.marketAddress,
        tokenId: String(position.tokenId),
        question: position.question?.title ?? null,
        outcome: position.outcome?.name ?? null,
        costBasisUsdt: roundUsd(costBasisUsdt),
        fullExitValueUsdt: roundUsd(fullExitValueUsdt),
        profitMultiple: roundUsd(profitMultiple),
        profitPct: roundUsd((profitMultiple - 1) * 100),
        peakProfitMultiple: roundUsd(record.peakProfitMultiple ?? profitMultiple),
        peakProfitPct: roundUsd(((record.peakProfitMultiple ?? profitMultiple) - 1) * 100)
      };

      const triggers = autoSellTriggers(cfg, position, record, {
        walletAddress,
        nowMs,
        costBasisUsdt,
        fullExitValueUsdt,
        profitMultiple
      }).map((trigger) => ({
        ...trigger,
        key: autoSellTriggerKey(walletAddress, position, trigger, cfg)
      }));
      const pendingTriggers = triggers.filter((trigger) => !seen.has(trigger.key));
      if (triggers.length > 0 && pendingTriggers.length === 0) {
        result.alreadyHandled += 1;
        continue;
      }
      if (pendingTriggers.length === 0) continue;
      const trigger = chooseAutoSellTrigger(pendingTriggers);

      result.triggered += 1;
      const sellPlan = await buildAutoSellExecutionPlan(cfg, publicClient, {
        position,
        walletAddress,
        trigger,
        fullQuote
      });
      const action = {
        ...summary,
        strategy: trigger.strategy,
        reason: trigger.reason,
        percent: trigger.percent,
        trigger,
        expectedCollateralToUserUsdt: roundUsd(rawUsdt(sellPlan.expectedCollateralToUser)),
        minCollateralOutUsdt: roundUsd(rawUsdt(sellPlan.minCollateralOut)),
        minOutMode: sellPlan.minOutMode ?? "quote",
        quoteReused: Boolean(sellPlan.quoteReused),
        operatorApproved: sellPlan.operatorApproved,
        txHash: null,
        status: cfg.dryRun || !cfg.execute ? "dry-run" : "pending"
      };

      let execution = null;
      if (!cfg.dryRun && cfg.execute) {
        execution = await sellOutcome(cfg, sellPlan);
        action.txHash = execution.txHash;
        action.status = execution.status;
        await syncRuntimeNonceAfterExternalTx(cfg, runtime, "auto-sell");
        if (execution.status === "success" || execution.status === "broadcast") {
          for (const pendingTrigger of pendingTriggers) seen.add(pendingTrigger.key);
          saveSeen(cfg.autoSellStateFile, seen);
          result.executed += 1;
        }
      }

      result.actions.push(action);
      appendJsonl(cfg.fillsFile, {
        level: "event-auto-sell",
        source,
        mode: cfg.dryRun || !cfg.execute ? "dry-run" : "execute",
        wallet: walletAddress,
        key: trigger.key,
        action,
        execution,
        at: new Date().toISOString()
      });
      notifyAutoSell(cfg, action, execution);
    } catch (error) {
      const item = {
        marketAddress: position.marketAddress,
        tokenId: String(position.tokenId),
        question: position.question?.title ?? null,
        outcome: position.outcome?.name ?? null,
        message: errorMessage(error)
      };
      result.errors.push(item);
      console.error(JSON.stringify({
        level: "event-auto-sell-position-error",
        source,
        ...item,
        at: new Date().toISOString()
      }));
    }
  }

  if (stateChanged) saveAutoSellPositionState(cfg.autoSellPositionStateFile, positionState);
  return result;
}

async function buildAutoSellExecutionPlan(cfg, publicClient, { position, walletAddress, trigger, fullQuote }) {
  const triggerPercent = Number(trigger.percent);
  const basePlan = triggerPercent === 100
    ? { ...fullQuote, quoteReused: true }
    : await quoteSellOutcome(publicClient, {
        market: position.marketAddress,
        tokenId: position.tokenId,
        owner: walletAddress,
        percent: trigger.percent,
        slippageBps: cfg.slippageBps
      });
  if (cfg.autoSellMinOutMode === "manual") {
    return {
      ...basePlan,
      minCollateralOut: parseUnits(String(cfg.autoSellManualMinOutUsdt ?? 0), 18),
      minOutMode: "manual"
    };
  }
  return {
    ...basePlan,
    minOutMode: "quote"
  };
}

function hasAutoSellStrategyEnabled(cfg) {
  return Boolean(
    cfg.autoSellOriginalEnabled ||
    cfg.autoSellFixedTrailingEnabled ||
    cfg.autoSellAdaptiveTrailingEnabled ||
    cfg.autoSellWeakExitEnabled ||
    cfg.autoSellBreakevenEnabled
  );
}

function isAutoSellablePosition(position) {
  if (!position) return false;
  if (position.isFinalized || position.isClaimed) return false;
  if (!position.marketAddress || position.tokenId === undefined || position.tokenId === null) return false;
  return Number(position.costBasis ?? 0) > 0 && Number(position.size ?? 0) > 0;
}

function autoSellKey(walletAddress, position, cfg) {
  return [
    String(walletAddress).toLowerCase(),
    String(position.marketAddress).toLowerCase(),
    String(position.tokenId),
    `tp${cfg.autoSellProfitMultiplier}`,
    `sell${cfg.autoSellPercent}`
  ].join(":");
}

function autoSellPositionKey(walletAddress, position) {
  return [
    String(walletAddress).toLowerCase(),
    String(position.marketAddress).toLowerCase(),
    String(position.tokenId)
  ].join(":");
}

function autoSellTriggerKey(walletAddress, position, trigger, cfg) {
  if (trigger.strategy === "original") return autoSellKey(walletAddress, position, cfg);
  const parts = [
    autoSellPositionKey(walletAddress, position),
    trigger.strategy,
    `sell${trigger.percent}`
  ];
  if (trigger.strategy === "fixed_trailing") {
    parts.push(
      `arm${cfg.autoSellTrailingArmProfitPct}`,
      `dd${cfg.autoSellTrailingDrawdownPct}`,
      `delay${cfg.autoSellTrailingStartDelaySeconds}`
    );
  } else if (trigger.strategy === "adaptive_trailing") {
    parts.push(
      `arm${cfg.autoSellAdaptiveArmProfitPct}`,
      `early${cfg.autoSellAdaptiveEarlyDrawdownPct}`,
      `small${cfg.autoSellAdaptiveSmallDrawdownPct}`,
      `normal${cfg.autoSellAdaptiveNormalDrawdownPct}`,
      `large${cfg.autoSellAdaptiveLargeDrawdownPct}`
    );
  } else if (trigger.strategy === "weak_exit") {
    parts.push(
      `after${cfg.autoSellWeakExitAfterOpenSeconds}`,
      `peak${cfg.autoSellWeakExitMinPeakProfitPct}`,
      `current${cfg.autoSellWeakExitMaxCurrentProfitPct}`
    );
  } else if (trigger.strategy === "breakeven") {
    parts.push(
      `arm${cfg.autoSellBreakevenArmProfitPct}`,
      `exit${cfg.autoSellBreakevenExitProfitPct}`,
      `delay${cfg.autoSellBreakevenStartDelaySeconds}`
    );
  }
  return parts.join(":");
}

function autoSellTriggers(cfg, position, record, context) {
  const triggers = [];
  const currentMultiple = context.profitMultiple;
  const peakMultiple = record.peakProfitMultiple ?? currentMultiple;
  const elapsedSeconds = autoSellElapsedSeconds(record, context.nowMs);
  const drawdownPct = peakMultiple > 0 ? (1 - currentMultiple / peakMultiple) * 100 : 0;
  const currentProfitPct = (currentMultiple - 1) * 100;
  const peakProfitPct = (peakMultiple - 1) * 100;

  if (cfg.autoSellOriginalEnabled && currentMultiple >= cfg.autoSellProfitMultiplier) {
    triggers.push({
      strategy: "original",
      reason: "profit_multiple",
      percent: cfg.autoSellPercent,
      priority: 10,
      currentProfitPct: roundUsd(currentProfitPct),
      peakProfitPct: roundUsd(peakProfitPct),
      drawdownPct: roundUsd(drawdownPct),
      triggerMultiple: cfg.autoSellProfitMultiplier
    });
  }

  if (
    cfg.autoSellFixedTrailingEnabled &&
    elapsedSeconds >= cfg.autoSellTrailingStartDelaySeconds &&
    peakProfitPct >= cfg.autoSellTrailingArmProfitPct &&
    drawdownPct >= cfg.autoSellTrailingDrawdownPct
  ) {
    triggers.push({
      strategy: "fixed_trailing",
      reason: "peak_drawdown",
      percent: cfg.autoSellTrailingPercent,
      priority: 30,
      currentProfitPct: roundUsd(currentProfitPct),
      peakProfitPct: roundUsd(peakProfitPct),
      drawdownPct: roundUsd(drawdownPct),
      armProfitPct: cfg.autoSellTrailingArmProfitPct,
      drawdownTriggerPct: cfg.autoSellTrailingDrawdownPct
    });
  }

  if (
    cfg.autoSellAdaptiveTrailingEnabled &&
    elapsedSeconds >= cfg.autoSellAdaptiveStartDelaySeconds &&
    peakProfitPct >= cfg.autoSellAdaptiveArmProfitPct
  ) {
    const adaptive = adaptiveDrawdownPct(cfg, record, context.nowMs);
    if (drawdownPct >= adaptive.drawdownPct) {
      triggers.push({
        strategy: "adaptive_trailing",
        reason: "adaptive_peak_drawdown",
        percent: cfg.autoSellAdaptivePercent,
        priority: 30,
        currentProfitPct: roundUsd(currentProfitPct),
        peakProfitPct: roundUsd(peakProfitPct),
        drawdownPct: roundUsd(drawdownPct),
        armProfitPct: cfg.autoSellAdaptiveArmProfitPct,
        drawdownTriggerPct: adaptive.drawdownPct,
        volatilityMode: adaptive.mode,
        volatilitySamples: adaptive.samples,
        p75JumpPct: adaptive.p75JumpPct,
        rangePct: adaptive.rangePct
      });
    }
  }

  if (
    cfg.autoSellWeakExitEnabled &&
    elapsedSeconds >= cfg.autoSellWeakExitAfterOpenSeconds &&
    peakProfitPct < cfg.autoSellWeakExitMinPeakProfitPct &&
    currentProfitPct <= cfg.autoSellWeakExitMaxCurrentProfitPct
  ) {
    triggers.push({
      strategy: "weak_exit",
      reason: "profit_not_reached_by_deadline",
      percent: cfg.autoSellWeakExitPercent,
      priority: 40,
      currentProfitPct: roundUsd(currentProfitPct),
      peakProfitPct: roundUsd(peakProfitPct),
      requiredPeakProfitPct: cfg.autoSellWeakExitMinPeakProfitPct,
      deadlineSeconds: cfg.autoSellWeakExitAfterOpenSeconds
    });
  }

  if (
    cfg.autoSellBreakevenEnabled &&
    elapsedSeconds >= cfg.autoSellBreakevenStartDelaySeconds &&
    peakProfitPct >= cfg.autoSellBreakevenArmProfitPct &&
    currentProfitPct <= cfg.autoSellBreakevenExitProfitPct
  ) {
    triggers.push({
      strategy: "breakeven",
      reason: "fell_back_to_cost",
      percent: cfg.autoSellBreakevenPercent,
      priority: 50,
      currentProfitPct: roundUsd(currentProfitPct),
      peakProfitPct: roundUsd(peakProfitPct),
      armProfitPct: cfg.autoSellBreakevenArmProfitPct,
      exitProfitPct: cfg.autoSellBreakevenExitProfitPct
    });
  }

  return triggers;
}

function chooseAutoSellTrigger(triggers) {
  return [...triggers].sort((a, b) =>
    b.percent - a.percent ||
    b.priority - a.priority ||
    String(a.strategy).localeCompare(String(b.strategy))
  )[0];
}

function autoSellElapsedSeconds(record, nowMs) {
  const start = Math.max(Number(record.marketStartAt ?? 0), Number(record.firstSeenAt ?? 0));
  if (!Number.isFinite(start) || start <= 0) return 0;
  return Math.max(0, (nowMs - start) / 1000);
}

function adaptiveDrawdownPct(cfg, record, nowMs) {
  const elapsedSeconds = autoSellElapsedSeconds(record, nowMs);
  if (elapsedSeconds < cfg.autoSellAdaptiveEarlySeconds) {
    return {
      mode: "early_fixed",
      drawdownPct: cfg.autoSellAdaptiveEarlyDrawdownPct,
      samples: 0,
      p75JumpPct: null,
      rangePct: null
    };
  }

  const windowMs = cfg.autoSellAdaptiveWindowSeconds * 1000;
  const observations = (record.observations ?? [])
    .filter((item) => item.at >= nowMs - windowMs && item.at <= nowMs && Number(item.profitMultiple) > 0)
    .sort((a, b) => a.at - b.at);
  if (observations.length < cfg.autoSellAdaptiveMinSamples) {
    return {
      mode: "fallback_fixed",
      drawdownPct: cfg.autoSellAdaptiveEarlyDrawdownPct,
      samples: observations.length,
      p75JumpPct: null,
      rangePct: null
    };
  }

  const jumps = [];
  for (let i = 1; i < observations.length; i += 1) {
    const previous = Number(observations[i - 1].profitMultiple);
    const current = Number(observations[i].profitMultiple);
    if (previous > 0 && current > 0) jumps.push(Math.abs(current / previous - 1) * 100);
  }
  const multiples = observations.map((item) => Number(item.profitMultiple));
  const minMultiple = Math.min(...multiples);
  const maxMultiple = Math.max(...multiples);
  const rangePct = minMultiple > 0 ? (maxMultiple / minMultiple - 1) * 100 : Infinity;
  const p75JumpPct = percentile(jumps, 0.75) ?? 0;

  if (p75JumpPct <= cfg.autoSellAdaptiveSmallJumpPct && rangePct <= cfg.autoSellAdaptiveSmallRangePct) {
    return {
      mode: "small",
      drawdownPct: cfg.autoSellAdaptiveSmallDrawdownPct,
      samples: observations.length,
      p75JumpPct: roundUsd(p75JumpPct),
      rangePct: roundUsd(rangePct)
    };
  }
  if (p75JumpPct > cfg.autoSellAdaptiveLargeJumpPct || rangePct > cfg.autoSellAdaptiveLargeRangePct) {
    return {
      mode: "large",
      drawdownPct: cfg.autoSellAdaptiveLargeDrawdownPct,
      samples: observations.length,
      p75JumpPct: roundUsd(p75JumpPct),
      rangePct: roundUsd(rangePct)
    };
  }
  return {
    mode: "normal",
    drawdownPct: cfg.autoSellAdaptiveNormalDrawdownPct,
    samples: observations.length,
    p75JumpPct: roundUsd(p75JumpPct),
    rangePct: roundUsd(rangePct)
  };
}

function percentile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))];
}

function loadAutoSellPositionState(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return {
        version: 1,
        positions: json.positions && typeof json.positions === "object" ? json.positions : {}
      };
    }
  } catch {
    // Missing or corrupt state should not stop the bot from evaluating positions.
  }
  return { version: 1, positions: {} };
}

function saveAutoSellPositionState(file, state) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(file);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // chmod is best-effort on Windows.
  }
}

function updateAutoSellPositionRecord(state, key, item) {
  const record = state.positions[key] ?? {};
  const firstSeenAt = Number(record.firstSeenAt ?? item.nowMs);
  const marketStartAt = Number.isFinite(item.marketStartMs) && item.marketStartMs > 0
    ? item.marketStartMs
    : Number(record.marketStartAt ?? firstSeenAt);
  const peakProfitMultiple = Math.max(
    Number(record.peakProfitMultiple ?? 0),
    Number(item.profitMultiple ?? 0)
  );
  const observations = Array.isArray(record.observations) ? record.observations : [];
  observations.push({
    at: item.nowMs,
    profitMultiple: roundUsd(item.profitMultiple)
  });
  const trimmedObservations = observations
    .filter((obs) => obs.at >= item.nowMs - 3600000)
    .slice(-240);

  const next = {
    ...record,
    firstSeenAt,
    marketStartAt,
    lastSeenAt: item.nowMs,
    costBasisUsdt: roundUsd(item.costBasisUsdt),
    fullExitValueUsdt: roundUsd(item.fullExitValueUsdt),
    profitMultiple: roundUsd(item.profitMultiple),
    peakProfitMultiple: roundUsd(peakProfitMultiple),
    observations: trimmedObservations
  };
  state.positions[key] = next;
  return next;
}

async function resolvePositionMarketStartMs(cfg, position, marketCache, record = null) {
  const direct = firstFiniteTimestamp([
    position.market?.startDate,
    position.market?.start_date,
    position.question?.startDate,
    position.question?.start_date,
    position.startDate,
    position.start_date
  ]);
  if (direct !== null) return direct;
  if (Number.isFinite(Number(record?.marketStartAt)) && Number(record.marketStartAt) > 0) {
    return Number(record.marketStartAt);
  }
  const key = String(position.marketAddress ?? "").toLowerCase();
  if (!key) return null;
  if (!marketCache.has(key)) {
    marketCache.set(key, fetchMarket(cfg, position.marketAddress).catch(() => null));
  }
  const market = await marketCache.get(key);
  return firstFiniteTimestamp([market?.startDate, market?.start_date]);
}

function firstFiniteTimestamp(values) {
  for (const value of values) {
    if (!value) continue;
    const numberValue = typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())
      ? Number(value)
      : null;
    const ms = typeof value === "number" || numberValue !== null
      ? ((numberValue ?? value) > 1000000000000 ? (numberValue ?? value) : (numberValue ?? value) * 1000)
      : Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function rawUsdt(value) {
  const raw = typeof value === "bigint" ? value : BigInt(value);
  return Number(formatUnits(raw, 18));
}

async function syncRuntimeNonceAfterExternalTx(cfg, runtime, reason) {
  if (!runtime || runtime.nextNonce === undefined || cfg.dryRun || !cfg.execute) return;
  const { publicClient, account } = makeClients(cfg);
  if (!account) return;
  const pendingNonce = Number(await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending"
  }));
  const previousNonce = runtime.nextNonce;
  runtime.nextNonce = Math.max(runtime.nextNonce, pendingNonce);
  runtime.lastNonceSyncAt = Date.now();
  if (runtime.nextNonce !== previousNonce) {
    console.error(JSON.stringify({
      level: "warn",
      source: "nonce-sync-after-external-tx",
      reason,
      previousNonce,
      nextNonce: runtime.nextNonce,
      pendingNonce,
      at: new Date().toISOString()
    }));
  }
}

async function waitForWatchFunding(cfg, options = {}) {
  writeFundingWaitRuntimeStatus(cfg, {
    ready: false,
    message: "Waiting for funding check"
  }, {
    autoSellMonitor: options.autoSellMonitor ?? null,
    fundingWaitWsDiscoveryMonitor: options.fundingWaitWsDiscoveryMonitor ?? null
  });
  while (true) {
    let retryMs = cfg.armFundingRetryMs;
    try {
      const fundingStatus = await getWatchFundingStatus(cfg);
      if (fundingStatus.skipped || fundingStatus.ready) {
        console.log(JSON.stringify({
          level: "event-arm-funding-ready",
          address: fundingStatus.address ?? null,
          minimumRequiredBusdt: fundingStatus.funding?.minimumRequiredBusdt ?? fundingStatus.funding?.requiredBusdt ?? null,
          fullBatchRequiredBusdt: fundingStatus.funding?.requiredBusdt ?? null,
          minimumRequiredBnbGasReserve: fundingStatus.minimumGasReserve?.requiredBnb ?? fundingStatus.gasReserve?.requiredBnb ?? null,
          fullBatchRequiredBnbGasReserve: fundingStatus.gasReserve?.requiredBnb ?? null,
          partialReady: Boolean(fundingStatus.partialReady),
          message: fundingStatus.message ?? null,
          at: new Date().toISOString()
        }));
        return fundingStatus;
      }
      retryMs = nextFundingRetryMs(cfg, fundingStatus);
      writeFundingWaitRuntimeStatus(cfg, fundingStatus, {
        autoSellMonitor: options.autoSellMonitor ?? null,
        fundingWaitWsDiscoveryMonitor: options.fundingWaitWsDiscoveryMonitor ?? null
      });
      console.error(JSON.stringify({
        level: "event-arm-waiting-for-funds",
        message: fundingStatus.message,
        wallet: fundingStatus.wallet,
        funding: fundingStatus.funding,
        gasReserve: fundingStatus.gasReserve,
        retryMs,
        msUntilNextStart: fundingMsUntilStart(fundingStatus),
        at: new Date().toISOString()
      }));
    } catch (error) {
      writeFundingWaitRuntimeStatus(cfg, {
        ready: false,
        error: true,
        message: errorMessage(error)
      }, {
        autoSellMonitor: options.autoSellMonitor ?? null,
        fundingWaitWsDiscoveryMonitor: options.fundingWaitWsDiscoveryMonitor ?? null
      });
      console.error(JSON.stringify({
        level: "event-arm-waiting-error",
        message: errorMessage(error),
        retryMs,
        at: new Date().toISOString()
      }));
    }
    await sleep(retryMs);
  }
}

function nextFundingRetryMs(cfg, fundingStatus) {
  const msUntilNextStart = fundingMsUntilStart(fundingStatus);
  if (
    msUntilNextStart !== null &&
    cfg.armFundingHotWindowMs > 0 &&
    msUntilNextStart >= 0 &&
    msUntilNextStart <= cfg.armFundingHotWindowMs
  ) {
    return Math.min(cfg.armFundingRetryMs, cfg.armFundingHotRetryMs);
  }
  return cfg.armFundingRetryMs;
}

function fundingMsUntilStart(fundingStatus) {
  const startDate = fundingStatus?.funding?.nextBatchStartDate;
  if (!startDate) return null;
  const ts = Date.parse(startDate);
  if (!Number.isFinite(ts)) return null;
  return ts - Date.now();
}

function describeFundingRecovery(fundingRecovery) {
  if (!fundingRecovery?.enabled) return null;
  return {
    enabled: true,
    waitingSince: new Date(fundingRecovery.waitingSince).toISOString(),
    fundingReadyAt: new Date(fundingRecovery.fundingReadyAt).toISOString()
  };
}

async function getWatchFundingStatus(cfg) {
  if (cfg.dryRun || !cfg.execute || cfg.eventBuyMode !== "fast") {
    return { skipped: true, ready: true };
  }
  const { publicClient } = makeClients(cfg);
  const [chain, restFutureMarkets] = await Promise.all([
    loadChainEventMarkets(cfg, { lookbackBlocks: cfg.eventLogLookbackBlocks }),
    loadUpcomingRestEventMarkets(cfg)
  ]);
  const funding = computeFundingRequirement(cfg, mergeMarketLists(chain.eventMarkets, restFutureMarkets));
  const [gasReserve, minimumGasReserve] = await Promise.all([
    estimateFastGasReserve(publicClient, cfg, funding),
    estimateFastGasReserve(publicClient, cfg, minimumExecutionFunding(funding))
  ]);
  const walletStatus = await getWalletStatus(cfg);
  const readiness = walletFundingReadiness(walletStatus, funding, gasReserve, minimumGasReserve);
  const { balanceReady, allowanceReady, bnbReady, ready } = readiness;
  const message = ready
    ? readiness.message
    : `Watch preflight failed: BUSDT balance ${walletStatus.busdtBalance}, allowance ${walletStatus.busdtAllowanceToRouter}, minimum required ${funding.minimumRequiredBusdt} (${funding.reason}); full batch requires ${funding.requiredBusdt}; BNB balance ${walletStatus.bnbBalance}, minimum gas reserve ${minimumGasReserve.requiredBnb} (${minimumGasReserve.mode})`;
  return {
    address: walletStatus.address,
    funding,
    gasReserve,
    minimumGasReserve,
    ready,
    partialReady: ready && !readiness.fullBatchReady,
    balanceReady,
    allowanceReady,
    bnbReady,
    fullBatchReady: readiness.fullBatchReady,
    fullBatchBalanceReady: readiness.fullBatchBalanceReady,
    fullBatchAllowanceReady: readiness.fullBatchAllowanceReady,
    fullBatchBnbReady: readiness.fullBatchBnbReady,
    message,
    wallet: {
      address: walletStatus.address,
      bnbBalance: walletStatus.bnbBalance,
      busdtBalance: walletStatus.busdtBalance,
      busdtAllowanceToRouter: walletStatus.busdtAllowanceToRouter,
      minimumRequiredBusdt: funding.minimumRequiredBusdt,
      fullBatchRequiredBusdt: funding.requiredBusdt,
      balanceReady,
      allowanceReady,
      bnbReady,
      fullBatchReady: readiness.fullBatchReady,
      fullBatchBalanceReady: readiness.fullBatchBalanceReady,
      fullBatchAllowanceReady: readiness.fullBatchAllowanceReady,
      fullBatchBnbReady: readiness.fullBatchBnbReady
    }
  };
}

async function validateWatchFunding(cfg) {
  const fundingStatus = await getWatchFundingStatus(cfg);
  if (!fundingStatus.ready) throw new Error(fundingStatus.message);
  return fundingStatus;
}

async function seedStartupMarkets(cfg, seen, pending, runtime = null, options = {}) {
  const warnings = [];
  if (cfg.watchBuyExisting) return warnings;

  const restSeed = await seedExistingRestMarkets(cfg, seen, pending, runtime, options);
  if (!restSeed.ok) warnings.push({ source: "rest-seed", message: restSeed.message });
  console.log(
    JSON.stringify({
      level: "startup",
      seededExistingMarkets: restSeed.seededExistingMarkets,
      catchUpLiveMarkets: restSeed.catchUpLiveMarkets,
      pendingFutureMarkets: pending.size,
      preparedFutureMarkets: restSeed.preparedFutureMarkets,
      mode: "waiting-for-new-event-markets",
      restSeedOk: restSeed.ok,
      warning: restSeed.ok ? null : restSeed.message
    })
  );

  if (cfg.eventDiscovery !== "rest") {
    try {
      const seeded = await seedRecentChainMarkets(cfg, seen, pending, runtime, options);
      if (seeded.checkedLogs > 0) {
        console.log(JSON.stringify({ level: "startup-chain-replay", ...seeded }));
      }
    } catch (error) {
      const message = errorMessage(error);
      warnings.push({ source: "chain-replay", message });
      console.error(JSON.stringify({
        level: "warn",
        source: "startup-chain-replay",
        message,
        at: new Date().toISOString()
      }));
    }
  }

  return warnings;
}

async function seedExistingRestMarkets(cfg, seen, pending, runtime = null, options = {}) {
  let currentMarkets = [];
  try {
    currentMarkets = await loadStartupRestEventMarkets(cfg);
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error),
      seededExistingMarkets: 0,
      catchUpLiveMarkets: 0,
      preparedFutureMarkets: 0
    };
  }

  let seededExistingMarkets = 0;
  const catchUpMarkets = [];
  let preparedFutureMarkets = 0;
  for (const market of currentMarkets) {
    if (msUntilStart(market) > 0) {
      const record = await preparePendingRecord(cfg, market, runtime);
      if (record.preparedPlan) preparedFutureMarkets += 1;
      pending.set(eventSeenKey(market, cfg), record);
      notifyMarketDiscovered(cfg, market, record, "startup-rest-future");
    } else if (shouldCatchUpLiveMarket(cfg, market, options)) {
      catchUpMarkets.push(market);
    } else {
      markSkippedIfExpired(cfg, seen, market, "startup-rest-open-window") ||
        markSkippedCatchUpDisabled(cfg, seen, market, "startup-rest-catchup-disabled");
      seededExistingMarkets += 1;
    }
  }
  if (catchUpMarkets.length > 0) {
    await handleDiscoveredMarkets(cfg, seen, pending, sortMarketsByStartAsc(catchUpMarkets), runtime, {
      source: "startup-rest-catchup",
      hydrateDueOdds: true,
      hydrationSkipReason: "funding_recovery_catchup"
    });
  }
  saveSeen(cfg.stateFile, seen);
  return {
    ok: true,
    message: null,
    seededExistingMarkets,
    catchUpLiveMarkets: catchUpMarkets.length,
    preparedFutureMarkets
  };
}

async function seedRecentChainMarkets(cfg, seen, pending, runtime = null, options = {}) {
  const chain = await loadChainEventMarkets(cfg, { lookbackBlocks: cfg.eventLogLookbackBlocks });
  let seededSeen = 0;
  let pendingFuture = 0;
  let preparedFuture = 0;
  const catchUpMarkets = [];
  let skipped = 0;

  for (const market of sortMarketsByChainDesc(chain.decoded)) {
    const key = eventSeenKey(market, cfg);
    if (seen.has(key) || pending.has(key)) continue;
    if (filterEventMarkets([market], cfg).length === 0 && !shouldDeferOnchainOnlyForRestSafety(cfg, market, ["live"])) {
      seen.add(key);
      skipped += 1;
    } else if (msUntilStart(market) > 0 || shouldDeferOnchainOnlyForRestSafety(cfg, market, ["live"])) {
      const record = await preparePendingRecord(cfg, market, runtime);
      if (record.preparedPlan) preparedFuture += 1;
      pending.set(key, record);
      pendingFuture += 1;
      notifyMarketDiscovered(cfg, market, record, "startup-chain-future");
    } else if (shouldCatchUpLiveMarket(cfg, market, options)) {
      catchUpMarkets.push(market);
    } else {
      markSkippedIfExpired(cfg, seen, market, "startup-chain-open-window") ||
        markSkippedCatchUpDisabled(cfg, seen, market, "startup-chain-catchup-disabled");
      seededSeen += 1;
    }
  }
  if (catchUpMarkets.length > 0) {
    await handleDiscoveredMarkets(cfg, seen, pending, sortMarketsByStartAsc(catchUpMarkets), runtime, {
      source: "startup-chain-catchup",
      hydrateDueOdds: true,
      hydrationSkipReason: "funding_recovery_catchup"
    });
  }
  skipped += chain.decodeErrors.length;
  saveSeen(cfg.stateFile, seen);
  return {
    fromBlock: chain.fromBlock,
    toBlock: chain.head,
    checkedLogs: chain.controllerLogs,
    createNewMarketLogs: chain.createNewMarketLogs,
    seededSeen,
    catchUpLiveMarkets: catchUpMarkets.length,
    pendingFuture,
    preparedFuture,
    skipped,
    decodeErrors: chain.decodeErrors.length
  };
}

function shouldCatchUpLiveMarket(cfg, market, options = {}) {
  const recovery = options.fundingRecovery;
  if (!cfg.armCatchUpAfterFunding || !recovery?.enabled) return false;
  // Catch-up is a legacy zero-delay rescue path. Delayed REST-live mode must not
  // buy markets that are already open; they are handled by the 20s safety gate.
  if (cfg.eventBuyDelaySeconds > 0 || requiresRestLiveBeforeBuy(cfg)) return false;
  const start = new Date(market.startDate).getTime();
  if (!Number.isFinite(start)) return false;
  const now = Date.now();
  if (start > now) return false;

  const end = new Date(market.endDate).getTime();
  if (Number.isFinite(end) && now >= end) return false;
  if (cfg.allowLateBuy) return true;
  if (cfg.armCatchUpWindowMs <= 0) return false;
  return now - start <= Math.min(cfg.armCatchUpWindowMs, eventOpenWindowMs(cfg));
}

async function watchWs(cfg, seen, runtime, initialPending = new Map(), options = {}) {
  const { seedStartup = false } = options;
  const { publicClient } = makeClients(cfg);
  const wsClient = makeWsClient(cfg);
  const pending = new Map(initialPending);
  const queue = [];
  const txBuffers = new Map();
  const wakeSignal = createWakeSignal();
  const restDiscovery = createRestDiscoveryState();
  let wsFailed = false;
  let consecutiveErrors = 0;

  const unwatch = watchControllerLogs(wsClient, {
    onLogs: (logs) => {
      queue.push(...logs);
      wakeSignal.wake();
    },
    onError: (error) => {
      wsFailed = true;
      wakeSignal.wake();
      console.error(JSON.stringify({ level: "error", message: errorMessage(error), at: new Date().toISOString() }));
    }
  });

  console.log(JSON.stringify({ level: "ws-watch", url: redactSecretUrls(cfg.wsUrl) }));

  if (seedStartup) {
    const warnings = await seedStartupMarkets(cfg, seen, pending, runtime, options);
    console.log(JSON.stringify({
      level: "startup-after-ws-subscribe",
      pendingFutureMarkets: pending.size,
      startupWarnings: warnings
    }));
  }

  while (true) {
    try {
      await preSignHotPendingMarkets(cfg, pending, runtime);
      await drainDuePendingMarkets(cfg, seen, pending, runtime);

      while (queue.length > 0) addBufferedControllerLog(txBuffers, queue.shift());
      await drainControllerLogBuffers(publicClient, txBuffers, cfg, seen, pending, runtime);
      await preSignHotPendingMarkets(cfg, pending, runtime);
      maybePollRestDiscovery(cfg, seen, pending, runtime, restDiscovery, () => wakeSignal.wake());

      if (wsFailed) throw new Error("WebSocket event subscription failed");
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      console.error(JSON.stringify({ level: "error", message: errorMessage(error), at: new Date().toISOString() }));
      if (consecutiveErrors >= 3) {
        unwatch?.();
        console.error(JSON.stringify({
          level: "warn",
          message: "ws discovery failed repeatedly; falling back to chain polling",
          at: new Date().toISOString()
        }));
        await watchChain(cfg, seen, runtime, pending);
        return;
      }
    }
    await wakeSignal.wait(nextWatchSleepMs(cfg, pending));
  }
}

async function watchRest(cfg, seen, runtime = null, initialPending = new Map()) {
  const pending = new Map(initialPending);
  while (true) {
    try {
      await preSignHotPendingMarkets(cfg, pending, runtime);
      await drainDuePendingMarkets(cfg, seen, pending, runtime);

      const markets = await loadRestDiscoveryEventMarkets(cfg);
      await refreshPendingRestSafetyFromRest(cfg, seen, pending, runtime, markets, "rest-watch");
      await handleDiscoveredMarkets(cfg, seen, pending, sortMarketsByStartAsc(markets), runtime, {
        source: "rest-watch",
        hydrateDueOdds: true,
        hydrationSkipReason: "rest_watch_poll",
        eventStatuses: REST_DISCOVERY_STATUSES
      });
      await preSignHotPendingMarkets(cfg, pending, runtime);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: errorMessage(error), at: new Date().toISOString() }));
    }
    await sleep(nextWatchSleepMs(cfg, pending));
  }
}

function createRestDiscoveryState() {
  return {
    nextPollAt: 0,
    running: false
  };
}

function maybePollRestDiscovery(cfg, seen, pending, runtime, state, onUpdate = null) {
  if (!cfg.restDiscoveryEnabled || cfg.eventDiscovery === "rest") return;
  const now = Date.now();
  if (state.running || now < state.nextPollAt) return;

  state.running = true;
  void runRestDiscoveryPoll(cfg, seen, pending, runtime, state, onUpdate);
}

async function runRestDiscoveryPoll(cfg, seen, pending, runtime, state, onUpdate = null) {
  try {
    const markets = await loadRestDiscoveryEventMarkets(cfg);
    const refreshed = await refreshPendingRestSafetyFromRest(
      cfg,
      seen,
      pending,
      runtime,
      markets,
      "rest-discovery-poll"
    );
    const candidates = markets.filter((market) => {
      const key = eventSeenKey(market, cfg);
      return !seen.has(key) && !pending.has(key);
    });
    if (candidates.length > 0) {
      console.log(JSON.stringify({
        level: "rest-discovery-poll",
        candidates: candidates.length,
        at: new Date().toISOString()
      }));
      await handleDiscoveredMarkets(cfg, seen, pending, sortMarketsByStartAsc(candidates), runtime, {
        source: "rest-discovery-poll",
        hydrateDueOdds: true,
        hydrationSkipReason: "rest_discovery_poll",
        eventStatuses: REST_DISCOVERY_STATUSES
      });
    }
    if (refreshed || candidates.length > 0) onUpdate?.();
  } catch (error) {
    console.error(JSON.stringify({
      level: "warn",
      source: "rest-discovery-poll",
      message: errorMessage(error),
      retryInMs: cfg.restDiscoveryPollMs,
      at: new Date().toISOString()
    }));
  } finally {
    state.nextPollAt = Date.now() + cfg.restDiscoveryPollMs;
    state.running = false;
  }
}

async function refreshPendingRestSafetyFromRest(cfg, seen, pending, runtime, markets, source) {
  if (!cfg.requireRestBeforeBuy || pending.size === 0) return false;
  const byAddress = new Map(
    (markets ?? [])
      .filter((market) => market?.address)
      .map((market) => [String(market.address).toLowerCase(), market])
  );
  const requiredStatuses = requiredRestStatusesForSafety(cfg);
  let changed = false;

  await Promise.all([...pending.entries()].map(async ([key, record]) => {
    const market = pendingMarket(record);
    const restMarket = byAddress.get(String(market?.address ?? "").toLowerCase());
    if (!restMarket) return;

    const status = String(restMarket.status ?? "").toLowerCase();
    record.restLastSeenAt = new Date().toISOString();
    record.restLastStatus = status;
    if (requiredStatuses.length > 0 && !requiredStatuses.includes(status)) {
      if (record.safetyReady) {
        invalidateRecordSafety(record, `REST status changed to ${status || "unknown"}`);
        changed = true;
        console.error(JSON.stringify({
          level: "event-buy-safety-invalidated",
          source,
          market: market.address,
          question: market.question,
          restStatus: status || null,
          at: new Date().toISOString()
        }));
      }
      return;
    }
    if (record.safetyReady) return;

    const decision = await ensureMarketSafeForBuy(cfg, market, { restMarket });
    if (!decision.ok) {
      markSafetyDecision(cfg, seen, record, decision, `${source}-precheck`);
      if (!decision.retryable) {
        pending.delete(key);
        changed = true;
      }
      return;
    }
    if (!applyVerifiedSafetyToRecord(cfg, seen, record, runtime, decision, `${source}-precheck`)) {
      if (seen.has(key)) {
        pending.delete(key);
        changed = true;
      }
      return;
    }

    changed = true;
    console.log(JSON.stringify({
      level: "event-buy-safety-ready",
      source,
      market: record.market.address,
      question: record.market.question,
      restStatus: record.restLastStatus,
      startDate: record.market.startDate,
      msUntilAction: msUntilAction(record.market, cfg),
      at: new Date().toISOString()
    }));
  }));

  if (changed) saveSeen(cfg.stateFile, seen);
  return changed;
}

async function watchChain(cfg, seen, runtime = null, initialPending = new Map()) {
  const { publicClient } = makeClients(cfg);
  let fromBlock = await waitForInitialChainBlock(cfg, publicClient);
  if (cfg.eventLogLookbackBlocks > 0) {
    fromBlock -= BigInt(cfg.eventLogLookbackBlocks);
  }
  let consecutiveErrors = 0;
  const pending = new Map(initialPending);
  const restDiscovery = createRestDiscoveryState();

  console.log(JSON.stringify({ level: "chain-watch", fromBlock: fromBlock.toString() }));

  while (true) {
    try {
      await preSignHotPendingMarkets(cfg, pending, runtime);
      await drainDuePendingMarkets(cfg, seen, pending, runtime);

      const toBlock = await publicClient.getBlockNumber();
      if (toBlock >= fromBlock) {
        const logs = await fetchControllerLogs(publicClient, { fromBlock, toBlock, chunkSize: cfg.logChunkBlocks });
        const { decoded, decodeErrors } = await decodeControllerMarketLogs(publicClient, logs, {
          createdAt: new Date().toISOString(),
          fallback: true
        });
        await handleDiscoveredMarkets(cfg, seen, pending, sortMarketsByChainDesc(decoded), runtime, {
          source: "chain-watch"
        });
        for (const error of decodeErrors) {
          console.error(JSON.stringify({ level: "warn", source: "chain-decode", ...error }));
        }
        await preSignHotPendingMarkets(cfg, pending, runtime);
        fromBlock = toBlock + 1n;
        consecutiveErrors = 0;
      }
      maybePollRestDiscovery(cfg, seen, pending, runtime, restDiscovery);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: errorMessage(error), at: new Date().toISOString() }));
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) {
        console.error(JSON.stringify({
          level: "warn",
          message: "chain discovery failed repeatedly; falling back to REST polling",
          at: new Date().toISOString()
        }));
        await watchRest(cfg, seen, runtime, pending);
        return;
      }
    }
    await sleep(nextWatchSleepMs(cfg, pending));
  }
}

async function waitForInitialChainBlock(cfg, publicClient) {
  while (true) {
    try {
      return await publicClient.getBlockNumber();
    } catch (error) {
      console.error(JSON.stringify({
        level: "warn",
        source: "chain-watch-startup",
        message: errorMessage(error),
        retryInMs: cfg.watchStartupRetryMs,
        at: new Date().toISOString()
      }));
      await sleep(cfg.watchStartupRetryMs);
    }
  }
}

async function drainControllerLogBuffers(publicClient, txBuffers, cfg, seen, pending, runtime) {
  const now = Date.now();
  for (const [txHash, bucket] of [...txBuffers]) {
    if (!bucket.logs.some(isCreationLog)) continue;

    const hasOutcomeData = bucket.logs.some(
      (log) => log.eventName === "CreateNewQuestionV2" || log.eventName === "AddOutcome"
    );
    const fallback = hasOutcomeData || now - bucket.firstSeenMs >= cfg.wsReceiptFallbackMs;
    const { decoded, decodeErrors } = await decodeControllerMarketLogs(publicClient, bucket.logs, {
      createdAt: new Date().toISOString(),
      fallback
    });
    if (decoded.length === 0) {
      if (!fallback) continue;
      bucket.fallbackAttempts = (bucket.fallbackAttempts ?? 0) + 1;
      if (bucket.fallbackAttempts <= cfg.wsReceiptFallbackRetries) {
        console.error(JSON.stringify({
          level: "warn",
          source: "ws-receipt-fallback",
          transactionHash: txHash,
          attempts: bucket.fallbackAttempts,
          errors: decodeErrors
        }));
        continue;
      }
    }

    txBuffers.delete(txHash);
    await handleDiscoveredMarkets(cfg, seen, pending, sortMarketsByChainDesc(decoded), runtime, {
      source: "ws-watch"
    });
    for (const error of decodeErrors) {
      console.error(JSON.stringify({ level: "warn", source: "ws-decode", ...error }));
    }
  }
}

async function drainFundingWaitWsLogBuffers(publicClient, txBuffers, cfg) {
  const now = Date.now();
  for (const [txHash, bucket] of [...txBuffers]) {
    if (!bucket.logs.some(isCreationLog)) continue;

    const hasOutcomeData = bucket.logs.some(
      (log) => log.eventName === "CreateNewQuestionV2" || log.eventName === "AddOutcome"
    );
    const fallback = hasOutcomeData || now - bucket.firstSeenMs >= cfg.wsReceiptFallbackMs;
    const { decoded, decodeErrors } = await decodeControllerMarketLogs(publicClient, bucket.logs, {
      createdAt: new Date().toISOString(),
      fallback
    });
    if (decoded.length === 0) {
      if (!fallback) continue;
      bucket.fallbackAttempts = (bucket.fallbackAttempts ?? 0) + 1;
      if (bucket.fallbackAttempts <= cfg.wsReceiptFallbackRetries) continue;
    }

    txBuffers.delete(txHash);
    handleFundingWaitWsMarkets(cfg, sortMarketsByChainDesc(decoded), "funding-wait-ws-readonly");
    for (const error of decodeErrors) {
      console.error(JSON.stringify({ level: "warn", source: "funding-wait-ws-decode", ...error }));
    }
  }
}

function handleFundingWaitWsMarkets(cfg, markets, source) {
  for (const market of markets) {
    const curveReason = marketCurveBlockReason(market);
    if (curveReason) {
      if (notifyBlockedCurveMarket(cfg, market, curveReason, source)) {
        const row = {
          level: "event-skip-curve",
          source,
          market: market.address,
          question: market.question,
          startDate: market.startDate,
          curve: market.curve ?? null,
          curveReason,
          reason: `blocked curve: ${curveReason}`,
          at: new Date().toISOString()
        };
        appendJsonl(cfg.fillsFile, row);
        console.log(JSON.stringify(row));
      }
      continue;
    }

    const chainCandidate = filterEventMarkets([market], {
      ...cfg,
      allowOnchainOnlyMarkets: true
    });
    if (chainCandidate.length === 0) continue;
    if (!notifyMarketDiscovered(cfg, market, null, source)) continue;
    console.log(JSON.stringify({
      level: "event-funding-wait-ws-discovery",
      source,
      market: market.address,
      question: market.question,
      startDate: market.startDate,
      at: new Date().toISOString()
    }));
  }
}

async function drainDuePendingMarkets(cfg, seen, pending, runtime) {
  skipExpiredPendingMarkets(cfg, seen, pending, "pending-open-window");
  skipRestNotLiveAtActionDeadline(cfg, seen, pending, "rest-live-deadline");
  const dueRecords = [...pending.values()].filter((record) => {
    return msUntilRecordAction(record, cfg) <= 0;
  });
  if (dueRecords.length === 0) return;

  if (cfg.bundleDueMarkets && cfg.eventBuyMode === "fast") {
    const grouped = groupRecordsByStartDate(dueRecords);
    const handled = new Set();
    for (const records of grouped.values()) {
      if (records.length <= 1 || !records.every((record) => record.preparedPlan)) continue;
      const ok = await executeDueBundle(cfg, seen, pending, runtime, records);
      if (ok) {
        for (const record of records) handled.add(eventSeenKey(pendingMarket(record), cfg));
      }
    }
    for (const key of handled) pending.delete(key);
  }

  for (const record of [...pending.values()]) {
    const market = pendingMarket(record);
    if (msUntilRecordAction(record, cfg) > 0) continue;
    const executed = await maybeExecuteMarket(cfg, seen, market, {
      allowFuturePending: false,
      runtime,
      preparedPlan: record.preparedPlan,
      preSignedFastTransaction: record.preSignedFastTransaction,
      hydrateOdds: false,
      hydrationSkipReason: "due_pending_record",
      retryRecord: record
    });
    if (executed || seen.has(eventSeenKey(market, cfg))) {
      pending.delete(eventSeenKey(market, cfg));
    }
  }
}

async function executeDueBundle(cfg, seen, pending, runtime, records) {
  if (records.some((record) => markSkippedIfExpired(cfg, seen, pendingMarket(record), "bundle-open-window"))) {
    saveSeen(cfg.stateFile, seen);
    return false;
  }
  if (marketSafetyGateEnabled(cfg)) {
    const safeRecords = [];
    for (const record of records) {
      if (await verifyRecordSafetyBeforeBuy(cfg, seen, record, runtime, "bundle-safety-gate")) {
        safeRecords.push(record);
      }
    }
    if (safeRecords.length !== records.length) saveSeen(cfg.stateFile, seen);
    if (safeRecords.length <= 1) return false;
    records = safeRecords;
  }
  const markets = records.map((record) => pendingMarket(record));
  try {
    let bundle = reusablePreSignedBundle(records);
    if (!bundle) {
      bundle = buildFastBuyBundlePlan(
        cfg,
        records.map((record) => record.preparedPlan),
        runtime?.receiverAddress || cfg.walletAddress || "0x0000000000000000000000000000000000000001"
      );
    }
    const preSigned = records.find((record) => record.preSignedFastBundleTransaction)?.preSignedFastBundleTransaction;
    if (preSigned) bundle = { ...bundle, preSignedFastBundleTransaction: preSigned };
    const result = await executeOrPrintBundle(bundle, cfg, runtime);
    appendJsonl(cfg.fillsFile, {
      bundle: describeFastBundlePlan(bundle),
      result,
      at: new Date().toISOString()
    });
    notifyBundleExecution(cfg, bundle, result);
    if (!executionMarksSeen(result)) {
      for (const record of records) markExecutionRetry(record, cfg, new Error(`execution status ${result.status ?? "unknown"}`));
      console.error(JSON.stringify({
        level: "warn",
        source: "bundle-execution",
        message: `Execution not confirmed successful: ${result.status ?? "unknown"}`,
        markets: markets.map((market) => market.address),
        retryInMs: cfg.executionRetryMs,
        at: new Date().toISOString()
      }));
      return false;
    }
    for (const record of records) clearExecutionRetry(record);
    for (const market of markets) {
      seen.add(eventSeenKey(market, cfg));
    }
    saveSeen(cfg.stateFile, seen);
    return true;
  } catch (error) {
    for (const record of records) markExecutionRetry(record, cfg, error);
    console.error(JSON.stringify({
      level: "warn",
      source: "bundle-execution",
      message: errorMessage(error),
      markets: markets.map((market) => market.address),
      retryInMs: cfg.executionRetryMs,
      at: new Date().toISOString()
    }));
    return false;
  }
}

async function preSignHotPendingMarkets(cfg, pending, runtime) {
  if (!shouldPreSignFastTransactions(cfg, runtime)) return;
  const now = Date.now();
  if (cfg.bundleDueMarkets && cfg.eventBuyMode === "fast") {
    const grouped = groupRecordsByStartDate([...pending.values()].filter((record) => {
      if (
        !record.preparedPlan ||
        !canPreSignPendingRecord(cfg, record) ||
        record.preSignedFastBundleTransaction ||
        !canRetryPreSign(record.bundlePreSignError, record.bundlePreSignRetryAfterMs, now, cfg)
      ) return false;
      const actionWaitMs = msUntilAction(pendingMarket(record), cfg);
      return actionWaitMs > 0 && actionWaitMs <= cfg.preSignWindowMs;
    }));

    for (const records of grouped.values()) {
      if (records.length <= 1) continue;
      await syncRuntimeNonceBeforePreSign(cfg, runtime, { reason: "bundle" });
      await attachPreSignedFastBundleTransaction(cfg, records, runtime);
    }
  }

  const records = [...pending.values()]
    .filter((record) => {
      if (
        !record.preparedPlan ||
        !canPreSignPendingRecord(cfg, record) ||
        record.preSignedFastTransaction ||
        record.preSignedFastBundleTransaction ||
        !canRetryPreSign(record.preSignError, record.preSignRetryAfterMs, now, cfg)
      ) return false;
      const actionWaitMs = msUntilAction(pendingMarket(record), cfg);
      return actionWaitMs > 0 && actionWaitMs <= cfg.preSignWindowMs;
    })
    .sort((a, b) => compareStartAsc(pendingMarket(a), pendingMarket(b)));

  for (const record of records) {
    await syncRuntimeNonceBeforePreSign(cfg, runtime, { reason: "single" });
    await attachPreSignedFastTransaction(cfg, record, runtime);
  }
}

async function syncRuntimeNonceBeforePreSign(cfg, runtime, { reason }) {
  if (
    !cfg.nonceSyncBeforePreSign ||
    !runtime ||
    runtime.nextNonce === undefined ||
    cfg.dryRun ||
    !cfg.execute
  ) return;

  const now = Date.now();
  if (
    runtime.lastNonceSyncAt &&
    now - runtime.lastNonceSyncAt < cfg.nonceSyncMinIntervalMs
  ) return;

  const { publicClient, account } = makeClients(cfg);
  if (!account) return;
  const pendingNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending"
  });
  runtime.lastNonceSyncAt = Date.now();
  if (pendingNonce > runtime.nextNonce) {
    const previousNonce = runtime.nextNonce;
    runtime.nextNonce = pendingNonce;
    console.error(JSON.stringify({
      level: "warn",
      source: "nonce-sync-before-presign",
      reason,
      previousNonce,
      pendingNonce,
      at: new Date().toISOString()
    }));
  }
}

async function attachPreSignedFastBundleTransaction(cfg, records, runtime) {
  if (!records.every((record) => record.preparedPlan)) return;
  if (records.some((record) => record.preSignedFastBundleTransaction)) return;
  try {
    const bundle = buildFastBuyBundlePlan(
      cfg,
      records.map((record) => record.preparedPlan),
      runtime?.receiverAddress || cfg.walletAddress || "0x0000000000000000000000000000000000000001"
    );
    const signed = await preSignFastBundleTransaction(cfg, bundle, runtime);
    for (const record of records) {
      record.preSignedFastBundleTransaction = signed;
      record.preSignedFastBundle = { ...bundle, preSignedFastBundleTransaction: signed };
      record.bundlePreSignedAt = new Date().toISOString();
      record.bundlePreSignError = null;
      record.bundlePreSignRetryAfterMs = null;
    }
    console.log(JSON.stringify({
      level: "pre-signed-fast-bundle-tx",
      txHash: signed.txHash,
      nonce: signed.nonce,
      marketCount: signed.marketCount,
      outcomeCount: signed.outcomeCount,
      markets: bundle.markets.map((market) => market.address),
      startDate: pendingMarket(records[0]).startDate,
      msUntilAction: msUntilAction(pendingMarket(records[0]), cfg)
    }));
  } catch (error) {
    const retryAfterMs = Date.now() + cfg.preSignRetryMs;
    for (const record of records) {
      record.bundlePreSignError = errorMessage(error);
      record.bundlePreSignAttempts = (record.bundlePreSignAttempts ?? 0) + 1;
      record.bundlePreSignRetryAfterMs = retryAfterMs;
    }
    console.error(JSON.stringify({
      level: "warn",
      source: "pre-sign-bundle",
      message: errorMessage(error),
      attempts: records[0]?.bundlePreSignAttempts ?? 1,
      retryInMs: cfg.preSignRetryMs,
      startDate: pendingMarket(records[0])?.startDate ?? null
    }));
  }
}

function reusablePreSignedBundle(records) {
  const first = records.find((record) => record.preSignedFastBundle);
  const bundle = first?.preSignedFastBundle;
  if (!bundle?.preSignedFastBundleTransaction) return null;

  const expectedHash = bundle.preSignedFastBundleTransaction.txHash;
  const expectedMarkets = new Set(bundle.markets.map((market) => String(market.address).toLowerCase()));
  if (expectedMarkets.size !== records.length) return null;

  const allSame = records.every((record) => {
    const market = pendingMarket(record);
    return (
      expectedMarkets.has(String(market.address).toLowerCase()) &&
      record.preSignedFastBundleTransaction?.txHash === expectedHash &&
      record.preSignedFastBundle?.preSignedFastBundleTransaction?.txHash === expectedHash
    );
  });
  return allSame ? bundle : null;
}

async function handleDiscoveredMarkets(cfg, seen, pending, markets, runtime, options = {}) {
  const immediateRecords = [];
  const futureDiscoveryNotifications = [];
  const immediateDiscoveryNotifications = [];
  const eventStatuses = options.eventStatuses ?? ["live"];
  const lockedKeys = new Set();
  try {
    for (const market of markets) {
      const key = eventSeenKey(market, cfg);
      if (seen.has(key) || pending.has(key) || activeDiscoveryKeys.has(key)) continue;
      activeDiscoveryKeys.add(key);
      lockedKeys.add(key);
      if (markSkippedIfBlockedCurve(cfg, seen, market, options.source ?? "discovery")) {
        saveSeen(cfg.stateFile, seen);
        continue;
      }
      if (filterEventMarkets([market], cfg, { statuses: eventStatuses }).length === 0) {
        if (shouldDeferOnchainOnlyForRestSafety(cfg, market, eventStatuses)) {
          const record = await preparePendingRecord(cfg, market, runtime, {
            hydrationSkipReason: "defer_until_rest_safety"
          });
          if (!seen.has(key) && !pending.has(key)) {
            pending.set(key, record);
            if (options.notify !== false) {
              futureDiscoveryNotifications.push({ market, record, source: options.source ?? "discovery" });
            }
          }
          continue;
        }
        seen.add(key);
        saveSeen(cfg.stateFile, seen);
        continue;
      }
      if (markSkippedIfExpired(cfg, seen, market, "discovery-open-window")) {
        saveSeen(cfg.stateFile, seen);
        continue;
      }

      const dueNow = msUntilAction(market, cfg) <= 0;
      const shouldHydrateDueOdds = Boolean(options.hydrateDueOdds);
      const record = await preparePendingRecord(cfg, market, runtime, {
        hydrateOdds: !(dueNow && cfg.fastSkipDueRestHydration && !shouldHydrateDueOdds),
        hydrationSkipReason: dueNow ? (options.hydrationSkipReason ?? "due_fast_path") : null
      });
      if (seen.has(key) || pending.has(key)) continue;
      if (dueNow) {
        if (options.notify !== false) {
          immediateDiscoveryNotifications.push({ market, record, source: options.source ?? "discovery" });
        }
        immediateRecords.push(record);
        continue;
      }

      await maybeExecuteMarket(cfg, seen, market, {
        allowFuturePending: true,
        runtime,
        preparedPlan: record.preparedPlan,
        preSignedFastTransaction: record.preSignedFastTransaction,
        retryRecord: record
      });
      if (!seen.has(key)) pending.set(key, record);
      if (options.notify !== false) {
        futureDiscoveryNotifications.push({ market, record, source: options.source ?? "discovery" });
      }
    }

    if (immediateRecords.length > 0) {
      if (cfg.bundleDueMarkets && cfg.eventBuyMode === "fast") {
        const grouped = groupRecordsByStartDate(immediateRecords);
        const bundled = new Set();
        for (const records of grouped.values()) {
          if (records.length <= 1 || !records.every((record) => record.preparedPlan)) continue;
          const ok = await executeDueBundle(cfg, seen, pending, runtime, records);
          if (ok) {
            for (const record of records) bundled.add(eventSeenKey(pendingMarket(record), cfg));
          }
        }
        if (bundled.size > 0) {
          console.log(JSON.stringify({
            level: "immediate-discovery-bundle",
            marketCount: bundled.size,
            at: new Date().toISOString()
          }));
        }
      }

      for (const record of immediateRecords) {
        const market = pendingMarket(record);
        const key = eventSeenKey(market, cfg);
        if (seen.has(key)) continue;
        const executed = await maybeExecuteMarket(cfg, seen, market, {
          allowFuturePending: false,
          runtime,
          preparedPlan: record.preparedPlan,
          preSignedFastTransaction: record.preSignedFastTransaction,
          hydrateOdds: false,
          hydrationSkipReason: "immediate_discovery_fast_path",
          retryRecord: record
        });
        if (!executed && !seen.has(key)) pending.set(key, record);
      }
    }

    for (const item of immediateDiscoveryNotifications) {
      notifyMarketDiscovered(cfg, item.market, item.record, item.source);
    }
    for (const item of futureDiscoveryNotifications) {
      notifyMarketDiscovered(cfg, item.market, item.record, item.source);
    }
  } finally {
    for (const key of lockedKeys) activeDiscoveryKeys.delete(key);
  }
}

function shouldDeferOnchainOnlyForRestSafety(cfg, market, statuses) {
  if (!marketSafetyGateEnabled(cfg) || requiredRestStatusesForSafety(cfg).length === 0) return false;
  if (!isOnchainOnlyMarket(market)) return false;
  return filterEventMarkets([market], { ...cfg, allowOnchainOnlyMarkets: true }, { statuses }).length > 0;
}

function isOnchainOnlyMarket(market) {
  const tags = (market?.tags ?? []).map((tag) => String(tag).toLowerCase());
  return tags.includes("onchain") &&
    !market?.oddsHydratedFrom &&
    (!Array.isArray(market?.categories) || market.categories.length === 0);
}

async function decodeControllerMarketLogs(publicClient, logs, { createdAt, fallback = true } = {}) {
  const built = buildMarketsFromControllerLogs(logs, { createdAt });
  const decoded = [...built.markets];
  const decodeErrors = [];

  if (!fallback) return { decoded, decodeErrors: built.errors };

  for (const error of built.errors) {
    const creationLog = findCreationLog(logs, error);
    if (!creationLog) {
      decodeErrors.push(error);
      continue;
    }
    try {
      decoded.push(await buildMarketFromCreationLog(publicClient, creationLog));
    } catch (fallbackError) {
      decodeErrors.push({ ...error, fallbackMessage: errorMessage(fallbackError) });
    }
  }

  return { decoded, decodeErrors };
}

async function loadChainEventMarkets(cfg, args = {}) {
  const { publicClient } = makeClients(cfg);
  const headBlock = await publicClient.getBlockNumber();
  const lookback = BigInt(args.lookbackBlocks ?? cfg.replayLookbackBlocks);
  const fromBlock = headBlock > lookback ? headBlock - lookback : 0n;
  const logs = await fetchControllerLogs(publicClient, {
    fromBlock,
    toBlock: headBlock,
    chunkSize: cfg.logChunkBlocks
  });
  const { decoded, decodeErrors } = await decodeControllerMarketLogs(publicClient, logs, {
    createdAt: new Date().toISOString(),
    fallback: true
  });
  const eventMarkets = sortMarketsByChainDesc(filterEventMarkets(decoded, cfg));
  return {
    head: headBlock.toString(),
    fromBlock: fromBlock.toString(),
    controllerLogs: logs.length,
    createNewMarketLogs: countCreationLogs(logs),
    decoded,
    decodedMarkets: decoded.length,
    eventMarkets,
    decodeErrors
  };
}

function addBufferedControllerLog(txBuffers, log) {
  if (!log?.transactionHash) return;
  const key = log.transactionHash;
  const bucket = txBuffers.get(key) ?? { firstSeenMs: Date.now(), logs: [] };
  const id = `${log.blockNumber?.toString() ?? ""}:${log.logIndex?.toString() ?? ""}:${log.eventName ?? ""}`;
  if (!bucket.logs.some((item) => `${item.blockNumber?.toString() ?? ""}:${item.logIndex?.toString() ?? ""}:${item.eventName ?? ""}` === id)) {
    bucket.logs.push(log);
  }
  txBuffers.set(key, bucket);
}

function findCreationLog(logs, error) {
  return logs.find(
    (log) =>
      isCreationLog(log) &&
      String(log.transactionHash).toLowerCase() === String(error.transactionHash).toLowerCase() &&
      String(log.args?.market).toLowerCase() === String(error.market).toLowerCase()
  );
}

function isCreationLog(log) {
  return log?.eventName === "CreateNewMarket";
}

function countCreationLogs(logs) {
  return logs.filter(isCreationLog).length;
}

function sortMarketsByChainDesc(markets) {
  return [...markets].sort((a, b) => {
    const blockDelta = BigInt(b.blockNumber ?? 0) - BigInt(a.blockNumber ?? 0);
    if (blockDelta !== 0n) return blockDelta > 0n ? 1 : -1;
    const txDelta = BigInt(b.transactionIndex ?? 0) - BigInt(a.transactionIndex ?? 0);
    if (txDelta !== 0n) return txDelta > 0n ? 1 : -1;
    const logDelta = BigInt(b.logIndex ?? 0) - BigInt(a.logIndex ?? 0);
    if (logDelta !== 0n) return logDelta > 0n ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function sortMarketsByStartAsc(markets) {
  return [...markets].sort(compareStartAsc);
}

function compareStartAsc(a, b) {
  return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
}

function groupRecordsByStartDate(records) {
  const groups = new Map();
  for (const record of records) {
    const market = pendingMarket(record);
    const key = new Date(market.startDate).getTime();
    if (!Number.isFinite(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

function selectedOutcomeCount(market, cfg) {
  return estimateSelectedOutcomeCount(market, cfg);
}

function selectedStakeUsdt(market, cfg) {
  return cfg.stakePerOutcomeUsdt * selectedOutcomeCount(market, cfg);
}

function batchSelectedOutcomeCount(markets, cfg) {
  return markets.reduce((sum, market) => sum + selectedOutcomeCount(market, cfg), 0);
}

function batchSelectedStakeUsdt(markets, cfg) {
  return roundUsd(markets.reduce((sum, market) => sum + selectedStakeUsdt(market, cfg), 0));
}

function singleMarketUpperBoundRequiredBusdt(cfg) {
  if ((cfg.eventOutcomeSelection ?? "lowest_odds") === "all") {
    return roundUsd(cfg.maxMarketStakeUsdt);
  }
  return roundUsd(cfg.stakePerOutcomeUsdt * Number(cfg.eventOutcomeCount ?? 5));
}

function computeFundingRequirement(cfg, eventMarkets = []) {
  const upperBoundRequiredBusdt = singleMarketUpperBoundRequiredBusdt(cfg);
  const futureMarkets = eventMarkets
    .filter((market) => msUntilStart(market) > 0)
    .sort(compareStartAsc);

  const nextBatchStartMs = futureMarkets.length > 0
    ? new Date(futureMarkets[0].startDate).getTime()
    : null;
  const nextBatch = Number.isFinite(nextBatchStartMs)
    ? futureMarkets.filter((market) => new Date(market.startDate).getTime() === nextBatchStartMs)
    : [];
  const nextBatchRequiredBusdt = roundUsd(nextBatch.reduce((sum, market) => {
    return sum + selectedStakeUsdt(market, cfg);
  }, 0));
  const minimumNextBatchRequiredBusdt = nextBatch.length > 0
    ? roundUsd(Math.min(...nextBatch.map((market) => selectedStakeUsdt(market, cfg))))
    : 0;
  const useNextBatch = cfg.watchFundingMode === "next_batch" && nextBatch.length > 0;
  const requiredBusdt = useNextBatch ? nextBatchRequiredBusdt : upperBoundRequiredBusdt;
  const minimumRequiredBusdt = useNextBatch ? minimumNextBatchRequiredBusdt : upperBoundRequiredBusdt;

  return {
    mode: cfg.watchFundingMode,
    reason: useNextBatch ? "known_next_opening_batch" : "single_market_upper_bound",
    requiredBusdt,
    minimumRequiredBusdt,
    upperBoundRequiredBusdt,
    nextBatchRequiredBusdt,
    minimumNextBatchRequiredBusdt,
    nextBatchMarketCount: nextBatch.length,
    nextBatchOutcomeCount: batchSelectedOutcomeCount(nextBatch, cfg),
    nextBatchAvailableOutcomeCount: nextBatch.reduce((sum, market) => sum + (market.outcomes?.length ?? 0), 0),
    nextBatchStartDate: nextBatch[0]?.startDate ?? null,
    nextBatchMarkets: nextBatch.map((market) => ({
      question: market.question,
      address: market.address,
      startDate: market.startDate,
      outcomeCount: selectedOutcomeCount(market, cfg),
      availableOutcomeCount: market.outcomes?.length ?? 0,
      totalStakeUsdt: roundUsd(selectedStakeUsdt(market, cfg))
    }))
  };
}

function minimumExecutionFunding(funding) {
  return {
    ...funding,
    requiredBusdt: funding.minimumRequiredBusdt ?? funding.requiredBusdt,
    nextBatchRequiredBusdt: funding.minimumRequiredBusdt ?? funding.nextBatchRequiredBusdt,
    nextBatchMarketCount: funding.nextBatchMarketCount > 0 ? 1 : 0
  };
}

function walletFundingReadiness(status, funding, gasReserve, minimumGasReserve) {
  const busdtBalance = Number(status.busdtBalance);
  const busdtAllowance = Number(status.busdtAllowanceToRouter);
  const bnbBalance = Number(status.bnbBalance);
  const minimumRequiredBusdt = Number(funding.minimumRequiredBusdt ?? funding.requiredBusdt);
  const fullBatchRequiredBusdt = Number(funding.requiredBusdt);
  const minimumRequiredBnb = Number(minimumGasReserve.requiredBnb);
  const fullBatchRequiredBnb = Number(gasReserve.requiredBnb);
  const balanceReady = busdtBalance >= minimumRequiredBusdt;
  const allowanceReady = busdtAllowance >= minimumRequiredBusdt;
  const bnbReady = bnbBalance >= minimumRequiredBnb;
  const fullBatchBalanceReady = busdtBalance >= fullBatchRequiredBusdt;
  const fullBatchAllowanceReady = busdtAllowance >= fullBatchRequiredBusdt;
  const fullBatchBnbReady = bnbBalance >= fullBatchRequiredBnb;
  const fullBatchReady = fullBatchBalanceReady && fullBatchAllowanceReady && fullBatchBnbReady;
  return {
    requiredBnbGasReserve: minimumGasReserve.requiredBnb,
    gasReserveMode: minimumGasReserve.mode,
    fullBatchRequiredBnbGasReserve: gasReserve.requiredBnb,
    fullBatchGasReserveMode: gasReserve.mode,
    balanceReady,
    allowanceReady,
    bnbReady,
    fullBatchReady,
    fullBatchBalanceReady,
    fullBatchAllowanceReady,
    fullBatchBnbReady,
    allowanceReadyForUpperBound: busdtAllowance >= funding.upperBoundRequiredBusdt,
    balanceReadyForUpperBound: busdtBalance >= funding.upperBoundRequiredBusdt,
    ready: balanceReady && allowanceReady && bnbReady,
    message: fullBatchReady ? null : "ready for partial execution; full next batch is underfunded"
  };
}

function buildFundingWalletSummary(status, requirement, gasReserve) {
  const busdtBalance = Number(status.busdtBalance);
  const busdtAllowance = Number(status.busdtAllowanceToRouter);
  const requiredBusdt = Number(requirement.requiredBusdt);
  const requiredBnb = Number(gasReserve.requiredBnb);
  const bnbBalance = Number(status.bnbBalance);
  const missingBusdt = Math.max(0, requiredBusdt - busdtBalance);
  const missingAllowance = Math.max(0, requiredBusdt - busdtAllowance);
  const missingBnb = Math.max(0, requiredBnb - bnbBalance);

  return {
    address: status.address,
    blockNumber: status.blockNumber,
    bnbBalance: status.bnbBalance,
    busdtBalance: status.busdtBalance,
    busdtAllowanceToRouter: status.busdtAllowanceToRouter,
    requiredBusdt: requirement.requiredBusdt,
    requiredBnbGasReserve: gasReserve.requiredBnb,
    gasReserveMode: gasReserve.mode,
    busdtBalanceReady: missingBusdt === 0,
    busdtAllowanceReady: missingAllowance === 0,
    bnbReady: missingBnb === 0,
    topUp: {
      missingBusdt: roundToken(missingBusdt, 6),
      missingBnb: roundToken(missingBnb, 9),
      missingAllowanceUsdt: roundToken(missingAllowance, 6),
      note: missingAllowance > 0 ? "BUSDT balance may be enough after top-up, but router allowance is still short; run event:approve from this wallet" : null
    }
  };
}

async function preparePendingRecord(cfg, market, runtime = null, options = {}) {
  const record = {
    market,
    preparedPlan: null,
    preparedAt: null,
    prepareError: null,
    preSignedFastTransaction: null,
    preSignedAt: null,
    preSignError: null,
    preSignAttempts: 0,
    preSignRetryAfterMs: null,
    preSignedFastBundleTransaction: null,
    preSignedFastBundle: null,
    bundlePreSignedAt: null,
    bundlePreSignError: null,
    bundlePreSignAttempts: 0,
    bundlePreSignRetryAfterMs: null,
    safetyChecks: null,
    safetyCheckedAt: null,
    safetyReady: false,
    safetyError: null,
    safetyRetryAfterMs: null,
    restLastSeenAt: null,
    restLastStatus: null,
    executionError: null,
    executionAttempts: 0,
    executionRetryAfterMs: null
  };
  if (cfg.eventBuyMode !== "fast") return record;

  try {
    const hydrateOdds = options.hydrateOdds !== false;
    const preparedMarket = hydrateOdds
      ? await maybeHydrateMarketOdds(cfg, market)
      : {
          ...market,
          oddsHydrationSkipped: options.hydrationSkipReason ?? "disabled"
        };
    record.market = preparedMarket;
    let plan = buildDirectBuyAllOutcomesPlan(preparedMarket, cfg);
    const receiver = runtime?.receiverAddress || cfg.walletAddress;
    if (receiver) {
      plan = withPrebuiltFastExecution(plan, receiver);
    }
    record.preparedPlan = plan;
    record.preparedAt = new Date().toISOString();
    record.prebuiltCalldata = Boolean(plan.prebuiltFastExecution);
  } catch (error) {
    record.prepareError = errorMessage(error);
  }
  return record;
}

async function maybeHydrateMarketOdds(cfg, market) {
  if (!needsRestOddsHydration(cfg, market)) return market;
  try {
    const restMarket = await fetchMarket(cfg, market.address);
    if (!restMarket?.outcomes?.length) return market;
    return mergeRestMarket(market, restMarket);
  } catch (error) {
    return {
      ...market,
      oddsHydrationError: errorMessage(error)
    };
  }
}

function needsRestOddsHydration(cfg, market) {
  if (cfg.eventOutcomeSelection !== "lowest_odds") return false;
  if (!Array.isArray(market.outcomes) || market.outcomes.length === 0) return false;
  return !hasCompleteOutcomeField(market, "payout") && !hasCompleteOutcomeField(market, "price");
}

function hasCompleteOutcomeField(market, field) {
  return (market.outcomes ?? []).every((outcome) => {
    if (outcome[field] === null || outcome[field] === undefined || outcome[field] === "") return false;
    return Number.isFinite(Number(outcome[field]));
  });
}

function mergeRestMarket(chainMarket, restMarket) {
  return {
    ...chainMarket,
    ...restMarket,
    address: chainMarket.address,
    status: chainMarket.status ?? restMarket.status,
    createdAt: chainMarket.createdAt ?? restMarket.createdAt,
    startDate: chainMarket.startDate ?? restMarket.startDate,
    endDate: chainMarket.endDate ?? restMarket.endDate,
    transactionHash: chainMarket.transactionHash,
    blockNumber: chainMarket.blockNumber,
    transactionIndex: chainMarket.transactionIndex,
    logIndex: chainMarket.logIndex,
    oddsHydratedFrom: "42 REST market detail"
  };
}

function marketSafetyGateEnabled(cfg) {
  return Boolean(
    requiredRestStatusesForSafety(cfg).length > 0 ||
    cfg.requireQuoteBeforeBuy ||
    cfg.requireChainMintBeforeBuy
  );
}

async function ensureMarketSafeForBuy(cfg, market, options = {}) {
  if (!marketSafetyGateEnabled(cfg)) {
    return { ok: true, market, checks: {} };
  }

  const checks = {};
  let restMarket = options.restMarket ?? null;
  let verifiedMarket = market;
  const requiredStatuses = requiredRestStatusesForSafety(cfg);
  const needRest = Boolean(
    cfg.requireRestBeforeBuy ||
    requiredStatuses.length > 0
  );

  if (restMarket) {
    checks.rest = {
      ok: true,
      source: options.restMarket ? "REST discovery poll" : "42 REST market detail",
      status: restMarket?.status ?? null,
      outcomeCount: restMarket?.outcomes?.length ?? null
    };
  }

  if (needRest && !restMarket) {
    try {
      restMarket = await fetchMarket(cfg, market.address);
      checks.rest = {
        ok: true,
        status: restMarket?.status ?? null,
        outcomeCount: restMarket?.outcomes?.length ?? null
      };
    } catch (error) {
      checks.rest = { ok: false, message: errorMessage(error) };
      if (cfg.requireRestBeforeBuy || requiredStatuses.length > 0) {
        return safetyFailure("REST has not synced this market yet", checks, {
          retryable: canWaitForSafetyWindow(cfg, market)
        });
      }
    }
  }

  if (restMarket) {
    verifiedMarket = {
      ...mergeRestMarket(market, restMarket),
      status: restMarket.status ?? market.status
    };
    if (
      requiredStatuses.length > 0 &&
      !requiredStatuses.includes(String(restMarket.status ?? "").toLowerCase())
    ) {
      return safetyFailure(`REST status ${restMarket.status ?? "unknown"} is not allowed`, checks, {
        retryable: canWaitForSafetyWindow(cfg, market)
      });
    }
    if (filterEventMarkets([verifiedMarket], cfg, { statuses: [String(restMarket.status ?? "")] }).length === 0) {
      return safetyFailure("REST market no longer matches buy strategy", checks, { retryable: false });
    }
    const mismatch = restMarketMismatch(market, restMarket);
    if (mismatch) return safetyFailure(mismatch, checks, { retryable: false });
  }

  if (containsAnyText(verifiedMarket.question ?? "", cfg.marketQuestionBlocklist)) {
    return safetyFailure("market question matches blocklist", checks, { retryable: false });
  }

  if (cfg.requireQuoteBeforeBuy) {
    try {
      const { publicClient } = makeClients(cfg);
      const quoteCfg = { ...cfg, dryRun: true, execute: false };
      const plan = await quoteBuyAllOutcomes(publicClient, verifiedMarket, quoteCfg, {
        stakePerOutcomeUsdt: cfg.stakePerOutcomeUsdt
      });
      checks.quote = {
        ok: true,
        selectedCount: plan.outcomes?.length ?? 0,
        totalStakeUsdt: plan.totalStakeUsdt ?? null
      };
    } catch (error) {
      checks.quote = { ok: false, message: errorMessage(error) };
      return safetyFailure("buy quote simulation failed", checks, {
        retryable: canWaitForSafetyWindow(cfg, market)
      });
    }
  }

  if (cfg.requireChainMintBeforeBuy) {
    try {
      const { publicClient } = makeClients(cfg);
      const mintLogCount = await countMarketMintLogs(cfg, publicClient, verifiedMarket);
      checks.chainMint = { ok: mintLogCount > 0, mintLogs: mintLogCount };
      if (mintLogCount <= 0) {
        return safetyFailure("no on-chain market mint logs yet", checks, {
          retryable: canWaitForSafetyWindow(cfg, market)
        });
      }
    } catch (error) {
      checks.chainMint = { ok: false, message: errorMessage(error) };
      return safetyFailure("chain mint check failed", checks, {
        retryable: canWaitForSafetyWindow(cfg, market)
      });
    }
  }

  return { ok: true, market: verifiedMarket, checks };
}

function requiredRestStatusesForSafety(cfg) {
  const configured = (cfg.requireRestStatus ?? [])
    .map((status) => String(status ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return cfg.requireRestBeforeBuy ? ["live"] : [];
}

function requiresRestLiveBeforeBuy(cfg) {
  return requiredRestStatusesForSafety(cfg).includes("live");
}

function canWaitForSafetyWindow(cfg, market) {
  const startMs = Date.parse(market?.startDate ?? "");
  if (!Number.isFinite(startMs)) return false;
  const delayMs = Math.max(0, Number(cfg.eventBuyDelaySeconds ?? 0)) * 1000;
  return Date.now() < startMs + delayMs;
}

function safetyFailure(reason, checks, { retryable }) {
  return {
    ok: false,
    reason,
    retryable: Boolean(retryable),
    checks
  };
}

function restMarketMismatch(chainMarket, restMarket) {
  const checks = [
    normalizedQuestionMismatch(chainMarket.question, restMarket.question),
    timestampFieldMismatch("startDate", chainMarket.startDate, restMarket.startDate),
    timestampFieldMismatch("endDate", chainMarket.endDate, restMarket.endDate),
    addressFieldMismatch("collateral", chainMarket.collateral, restMarket.collateral),
    addressFieldMismatch("curve", chainMarket.curve, restMarket.curve),
    stringFieldMismatch("parentTokenId", chainMarket.parentTokenId, restMarket.parentTokenId)
  ].filter(Boolean);
  if (Array.isArray(chainMarket.outcomes) && Array.isArray(restMarket.outcomes)) {
    if (chainMarket.outcomes.length !== restMarket.outcomes.length) {
      checks.push(`outcome count mismatch: chain=${chainMarket.outcomes.length} rest=${restMarket.outcomes.length}`);
    }
  }
  return checks[0] ?? null;
}

function normalizedQuestionMismatch(left, right) {
  if (!left || !right) return null;
  return normalizeQuestionForComparison(left) === normalizeQuestionForComparison(right)
    ? null
    : `question mismatch: chain=${left} rest=${right}`;
}

function timestampFieldMismatch(field, left, right) {
  if (!left || !right) return null;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return null;
  return Math.abs(leftMs - rightMs) > 1000 ? `${field} mismatch: chain=${left} rest=${right}` : null;
}

function addressFieldMismatch(field, left, right) {
  if (!left || !right) return null;
  return String(left).toLowerCase() === String(right).toLowerCase()
    ? null
    : `${field} mismatch: chain=${left} rest=${right}`;
}

function stringFieldMismatch(field, left, right) {
  if (left === undefined || left === null || right === undefined || right === null) return null;
  return String(left) === String(right) ? null : `${field} mismatch: chain=${left} rest=${right}`;
}

function normalizeQuestionForComparison(question) {
  return String(question ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function containsAnyText(text, needles = []) {
  const normalized = String(text ?? "").toLowerCase();
  return (needles ?? []).some((needle) => {
    const value = String(needle ?? "").trim().toLowerCase();
    return value && normalized.includes(value);
  });
}

async function countMarketMintLogs(cfg, publicClient, market) {
  const latestBlock = await publicClient.getBlockNumber();
  const latest = Number(latestBlock);
  const marketBlock = Number(market.blockNumber ?? 0);
  const lookback = Math.max(1, Number(cfg.eventLogLookbackBlocks ?? 50000));
  const fromBlock = Number.isFinite(marketBlock) && marketBlock > 0
    ? Math.max(1, marketBlock - 20)
    : Math.max(1, latest - lookback);
  const logs = await publicClient.getLogs({
    address: market.address,
    fromBlock: BigInt(fromBlock),
    toBlock: "latest",
    topics: [MARKET_MINT_TOPIC]
  });
  return logs.length;
}

function shouldPreSignFastTransactions(cfg, runtime) {
  return Boolean(
    cfg.preSignFastTx &&
    runtime &&
    cfg.eventBuyMode === "fast" &&
    !cfg.dryRun &&
    cfg.execute
  );
}

function canPreSignPendingRecord(cfg, record) {
  return !marketSafetyGateEnabled(cfg) || Boolean(record?.safetyReady);
}

async function attachPreSignedFastTransaction(cfg, record, runtime) {
  if (!record.preparedPlan || record.preSignedFastTransaction) return record;
  try {
    record.preSignedFastTransaction = await preSignFastBuyTransaction(cfg, record.preparedPlan, runtime);
    record.preSignedAt = new Date().toISOString();
    record.preSignError = null;
    record.preSignRetryAfterMs = null;
    console.log(JSON.stringify({
      level: "pre-signed-fast-tx",
      market: record.market.address,
      question: record.market.question,
      startDate: record.market.startDate,
      txHash: record.preSignedFastTransaction.txHash,
      nonce: record.preSignedFastTransaction.nonce,
      msUntilAction: msUntilAction(record.market, cfg)
    }));
  } catch (error) {
    record.preSignError = errorMessage(error);
    record.preSignAttempts = (record.preSignAttempts ?? 0) + 1;
    record.preSignRetryAfterMs = Date.now() + cfg.preSignRetryMs;
    console.error(JSON.stringify({
      level: "warn",
      source: "pre-sign-market",
      message: record.preSignError,
      attempts: record.preSignAttempts,
      retryInMs: cfg.preSignRetryMs,
      market: record.market.address,
      startDate: record.market.startDate
    }));
  }
  return record;
}

function canRetryPreSign(error, retryAfterMs, now, cfg) {
  if (!error) return true;
  if (cfg.preSignRetryMs <= 0) return false;
  return Number(retryAfterMs ?? 0) <= now;
}

function markExecutionRetry(record, cfg, error) {
  if (!record) return;
  record.executionError = errorMessage(error);
  record.executionAttempts = (record.executionAttempts ?? 0) + 1;
  record.executionRetryAfterMs = Date.now() + cfg.executionRetryMs;
}

async function verifyRecordSafetyBeforeBuy(cfg, seen, record, runtime, source) {
  if (record.safetyReady) return true;
  const market = pendingMarket(record);
  const decision = await ensureMarketSafeForBuy(cfg, market);
  if (!decision.ok) {
    markSafetyDecision(cfg, seen, record, decision, source);
    return false;
  }

  return applyVerifiedSafetyToRecord(cfg, seen, record, runtime, decision, source);
}

function applyVerifiedSafetyToRecord(cfg, seen, record, runtime, decision, source) {
  record.market = decision.market;
  record.preparedPlan = null;
  record.preSignedFastTransaction = null;
  record.preSignedFastBundleTransaction = null;
  record.preSignedFastBundle = null;
  record.safetyChecks = decision.checks;
  record.safetyCheckedAt = new Date().toISOString();
  record.safetyReady = true;
  clearSafetyRetry(record);

  if (cfg.eventBuyMode === "fast") {
    try {
      let plan = buildDirectBuyAllOutcomesPlan(record.market, cfg);
      const receiver = runtime?.receiverAddress || cfg.walletAddress;
      if (receiver) plan = withPrebuiltFastExecution(plan, receiver);
      record.preparedPlan = plan;
      record.preparedAt = new Date().toISOString();
      record.prebuiltCalldata = Boolean(plan.prebuiltFastExecution);
    } catch (error) {
      markSafetyDecision(cfg, seen, record, safetyFailure("fast plan rebuild failed", {
        ...decision.checks,
        plan: { ok: false, message: errorMessage(error) }
      }, { retryable: canWaitForSafetyWindow(cfg, record.market) }), source);
      record.safetyReady = false;
      return false;
    }
  }
  return true;
}

function invalidateRecordSafety(record, reason) {
  if (!record) return;
  record.safetyReady = false;
  record.safetyError = reason;
  record.preSignedFastTransaction = null;
  record.preSignedAt = null;
  record.preSignedFastBundleTransaction = null;
  record.preSignedFastBundle = null;
  record.bundlePreSignedAt = null;
}

function markSafetyDecision(cfg, seen, recordOrMarket, decision, source) {
  const market = pendingMarket(recordOrMarket);
  const key = eventSeenKey(market, cfg);
  const row = {
    level: decision.retryable ? "event-buy-safety-wait" : "event-skip-safety-gate",
    source,
    market: market.address,
    question: market.question,
    startDate: market.startDate,
    reason: decision.reason,
    retryable: Boolean(decision.retryable),
    checks: decision.checks,
    retryInMs: decision.retryable ? safetyRetryMs(cfg) : 0,
    at: new Date().toISOString()
  };

  if (decision.retryable) {
    markSafetyRetry(recordOrMarket, cfg, decision);
    if (shouldLogSafetyDecision(recordOrMarket, decision)) {
      appendJsonl(cfg.fillsFile, row);
      console.error(JSON.stringify(row));
    }
    return;
  }

  seen.add(key);
  appendJsonl(cfg.fillsFile, row);
  console.error(JSON.stringify(row));
}

function markSafetyRetry(recordOrMarket, cfg, decision) {
  if (!recordOrMarket || !Object.prototype.hasOwnProperty.call(recordOrMarket, "market")) return;
  recordOrMarket.safetyError = decision.reason;
  recordOrMarket.safetyRetryAfterMs = Date.now() + safetyRetryMs(cfg);
}

function clearSafetyRetry(record) {
  if (!record) return;
  record.safetyError = null;
  record.safetyRetryAfterMs = null;
}

function safetyRetryMs(cfg) {
  return Math.max(250, Number(cfg.executionRetryMs ?? 500));
}

function shouldLogSafetyDecision(recordOrMarket, decision) {
  if (!recordOrMarket || !Object.prototype.hasOwnProperty.call(recordOrMarket, "market")) return true;
  const now = Date.now();
  const previousReason = recordOrMarket.safetyLastLoggedReason;
  const previousAt = Number(recordOrMarket.safetyLastLoggedAt ?? 0);
  if (previousReason === decision.reason && now - previousAt < 5000) return false;
  recordOrMarket.safetyLastLoggedReason = decision.reason;
  recordOrMarket.safetyLastLoggedAt = now;
  return true;
}

function skipExpiredPendingMarkets(cfg, seen, pending, source) {
  let skipped = false;
  for (const [key, record] of [...pending.entries()]) {
    const market = pendingMarket(record);
    if (!markSkippedIfExpired(cfg, seen, market, source)) continue;
    pending.delete(key);
    skipped = true;
  }
  if (skipped) saveSeen(cfg.stateFile, seen);
}

function skipRestNotLiveAtActionDeadline(cfg, seen, pending, source) {
  if (!requiresRestLiveBeforeBuy(cfg)) return;
  let skipped = false;
  for (const [key, record] of [...pending.entries()]) {
    if (record.safetyReady) continue;
    const market = pendingMarket(record);
    if (msUntilAction(market, cfg) > 0) continue;
    const restStatus = String(record.restLastStatus ?? "").toLowerCase();
    if (restStatus === "live") continue;
    if (seen.has(key)) {
      pending.delete(key);
      skipped = true;
      continue;
    }
    const startMs = Date.parse(market?.startDate ?? "");
    const actionDeadlineMs = Number.isFinite(startMs)
      ? startMs + Math.max(0, Number(cfg.eventBuyDelaySeconds ?? 0)) * 1000
      : null;
    const row = {
      level: "event-skip-rest-live-deadline",
      source,
      market: market.address,
      question: market.question,
      startDate: market.startDate,
      eventBuyDelaySeconds: cfg.eventBuyDelaySeconds,
      restLastStatus: record.restLastStatus ?? null,
      actionDeadlineAt: actionDeadlineMs ? new Date(actionDeadlineMs).toISOString() : null,
      msPastActionDeadline: actionDeadlineMs ? Math.max(0, Date.now() - actionDeadlineMs) : null,
      reason: `REST status did not reach live by open + ${cfg.eventBuyDelaySeconds}s`,
      at: new Date().toISOString()
    };
    seen.add(key);
    pending.delete(key);
    appendJsonl(cfg.fillsFile, row);
    console.error(JSON.stringify(row));
    skipped = true;
  }
  if (skipped) saveSeen(cfg.stateFile, seen);
}

function markSkippedIfExpired(cfg, seen, market, source) {
  if (!isPastEventOpenWindow(cfg, market)) return false;
  const key = eventSeenKey(market, cfg);
  if (seen.has(key)) return true;
  const ageMs = marketOpenAgeMs(market);
  const row = {
    level: "event-skip-open-window",
    source,
    market: market.address,
    question: market.question,
    startDate: market.startDate,
    ageMs,
    eventOpenWindowSeconds: cfg.eventOpenWindowSeconds,
    reason: `market is ${Math.round(ageMs / 1000)}s past open; max ${cfg.eventOpenWindowSeconds}s`,
    at: new Date().toISOString()
  };
  seen.add(key);
  appendJsonl(cfg.fillsFile, row);
  console.error(JSON.stringify(row));
  return true;
}

function markSkippedIfBlockedCurve(cfg, seen, market, source) {
  const curveReason = marketCurveBlockReason(market);
  if (!curveReason) return false;
  const key = eventSeenKey(market, cfg);
  seen.add(key);
  const row = {
    level: "event-skip-curve",
    source,
    market: market.address,
    question: market.question,
    startDate: market.startDate,
    curve: market.curve ?? null,
    curveReason,
    reason: `blocked curve: ${curveReason}`,
    at: new Date().toISOString()
  };
  appendJsonl(cfg.fillsFile, row);
  console.log(JSON.stringify(row));
  notifyBlockedCurveMarket(cfg, market, curveReason, source);
  return true;
}

function markSkippedCatchUpDisabled(cfg, seen, market, source) {
  const key = eventSeenKey(market, cfg);
  if (seen.has(key)) return true;
  const ageMs = marketOpenAgeMs(market);
  const row = {
    level: "event-skip-catchup-disabled",
    source,
    market: market.address,
    question: market.question,
    startDate: market.startDate,
    ageMs,
    eventBuyDelaySeconds: cfg.eventBuyDelaySeconds,
    eventOpenWindowSeconds: cfg.eventOpenWindowSeconds,
    reason: "market was already open when discovered; catch-up buying is disabled",
    at: new Date().toISOString()
  };
  seen.add(key);
  appendJsonl(cfg.fillsFile, row);
  console.error(JSON.stringify(row));
  return true;
}

function isPastEventOpenWindow(cfg, market) {
  if (cfg.allowLateBuy) return false;
  const ageMs = marketOpenAgeMs(market);
  return Number.isFinite(ageMs) && ageMs > eventOpenWindowMs(cfg);
}

function marketOpenAgeMs(market) {
  const start = new Date(market?.startDate).getTime();
  if (!Number.isFinite(start)) return NaN;
  return Date.now() - start;
}

function eventOpenWindowMs(cfg) {
  return cfg.eventOpenWindowSeconds * 1000;
}

function clearExecutionRetry(record) {
  if (!record) return;
  record.executionError = null;
  record.executionRetryAfterMs = null;
}

function executionMarksSeen(result) {
  if (result?.dryRun) return true;
  return result?.status === "success" || (result?.status === "broadcast" && Boolean(result?.txHash));
}

function pendingMarket(record) {
  return record?.market ?? record;
}

function selectSellPositions(openPositions, args) {
  let selected = openPositions;
  if (args.market) {
    selected = selected.filter((position) =>
      String(position.marketAddress).toLowerCase() === String(args.market).toLowerCase()
    );
  }
  if (args.tokenId) {
    selected = selected.filter((position) => String(position.tokenId) === String(args.tokenId));
  }
  if (args.tokenIds) {
    const wanted = new Set(String(args.tokenIds).split(",").map((item) => item.trim()).filter(Boolean));
    selected = selected.filter((position) => wanted.has(String(position.tokenId)));
  }
  if (!args.all && selected.length !== 1) {
    const choices = selected.map((position) => ({
      marketAddress: position.marketAddress,
      tokenId: position.tokenId,
      question: position.question?.title ?? null,
      outcome: position.outcome?.name ?? null,
      size: position.size
    }));
    throw new Error(
      `sell needs exactly one position unless --all is set; matched ${selected.length}: ${JSON.stringify(choices)}`
    );
  }
  if (selected.length === 0) throw new Error("No matching open positions found");
  return selected;
}

function summarizeSellPlans(plans) {
  const totals = plans.reduce(
    (acc, plan) => {
      acc.expectedCollateralToUser += Number(plan.expectedCollateralToUser) / 1e18;
      acc.minCollateralOut += Number(plan.minCollateralOut) / 1e18;
      acc.collateralToIntegrator += Number(plan.collateralToIntegrator) / 1e18;
      return acc;
    },
    { expectedCollateralToUser: 0, minCollateralOut: 0, collateralToIntegrator: 0 }
  );
  return {
    expectedCollateralToUserUsdt: roundUsd(totals.expectedCollateralToUser),
    minCollateralOutUsdt: roundUsd(totals.minCollateralOut),
    collateralToIntegratorUsdt: roundUsd(totals.collateralToIntegrator),
    positionsNeedingOperatorApproval: plans.filter((plan) => !plan.operatorApproved).length
  };
}

function summarizePosition(position) {
  const costBasisUsdt = Number(position.costBasis ?? 0);
  const cashPnlUsdt = Number(position.cashPnl ?? 0);
  return {
    marketAddress: position.marketAddress,
    question: position.question?.title ?? null,
    outcome: position.outcome?.name ?? null,
    tokenId: position.tokenId,
    size: Number(position.size ?? 0),
    avgPrice: Number(position.avgPrice ?? 0),
    curPrice: Number(position.curPrice ?? 0),
    costBasisUsdt: roundUsd(costBasisUsdt),
    cashPnlUsdt: roundUsd(cashPnlUsdt),
    markValueUsdt: roundUsd(costBasisUsdt + cashPnlUsdt),
    percentPnl: roundUsd(Number(position.percentPnl ?? 0)),
    payoutIfRightUsdt: roundUsd(Number(position.outcome?.payout ?? 0)),
    isFinalized: Boolean(position.isFinalized),
    isClaimed: Boolean(position.isClaimed),
    isWinner: position.isWinner
  };
}

function roundUsd(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function roundToken(value, decimals = 6) {
  const scale = 10 ** decimals;
  return Math.round(Number(value) * scale) / scale;
}

function roundMs(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function summarizeBenchResults(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const totalHotPath = results.map((item) => item.totalHotPathMs);
  const preSign = results.map((item) => item.preSignMs);
  return {
    samples: results.length,
    avgTotalHotPathMs: roundMs(avg(totalHotPath)),
    minTotalHotPathMs: roundMs(Math.min(...totalHotPath)),
    maxTotalHotPathMs: roundMs(Math.max(...totalHotPath)),
    avgPreSignMs: roundMs(avg(preSign)),
    minPreSignMs: roundMs(Math.min(...preSign)),
    maxPreSignMs: roundMs(Math.max(...preSign))
  };
}

function avg(values) {
  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

async function maybeExecuteMarket(
  cfg,
  seen,
  market,
  {
    allowFuturePending = false,
    runtime = null,
    preparedPlan = null,
    preSignedFastTransaction = null,
    hydrateOdds = true,
    hydrationSkipReason = null,
    retryRecord = null
  } = {}
) {
  const key = eventSeenKey(market, cfg);
  if (seen.has(key)) return false;
  if (markSkippedIfExpired(cfg, seen, market, "single-open-window")) {
    saveSeen(cfg.stateFile, seen);
    return false;
  }

  const waitMs = msUntilStart(market);
  const actionWaitMs = msUntilAction(market, cfg);
  if (actionWaitMs > 0) {
    if (allowFuturePending) {
      console.log(JSON.stringify({
        level: "pending-start",
        market: market.address,
        question: market.question,
        startDate: market.startDate,
        prepared: Boolean(preparedPlan),
        prebuiltCalldata: Boolean(preparedPlan?.prebuiltFastExecution),
        preSigned: Boolean(preSignedFastTransaction),
        waitMs,
        actionWaitMs,
        prebroadcastMs: cfg.prebroadcastMs
      }));
    }
    return false;
  }

  if (waitMs > 0 && cfg.prebroadcastMs > 0) {
    console.log(JSON.stringify({
      level: "prebroadcast-window",
      market: market.address,
      question: market.question,
      startDate: market.startDate,
      waitMs,
      prebroadcastMs: cfg.prebroadcastMs
    }));
  }

  if (marketSafetyGateEnabled(cfg)) {
    if (retryRecord?.safetyReady) {
      market = retryRecord.market;
      preparedPlan = retryRecord.preparedPlan;
      preSignedFastTransaction = retryRecord.preSignedFastTransaction;
      hydrateOdds = false;
      hydrationSkipReason = "safety_gate_prechecked";
    } else {
      const decision = await ensureMarketSafeForBuy(cfg, market);
      if (!decision.ok) {
        markSafetyDecision(cfg, seen, retryRecord ?? market, decision, "single-safety-gate");
        if (!decision.retryable) saveSeen(cfg.stateFile, seen);
        return false;
      }
      market = decision.market;
      preparedPlan = null;
      preSignedFastTransaction = null;
      hydrateOdds = false;
      hydrationSkipReason = "safety_gate_verified";
      if (retryRecord) {
        if (!applyVerifiedSafetyToRecord(cfg, seen, retryRecord, runtime, decision, "single-safety-gate")) {
          if (seen.has(key)) saveSeen(cfg.stateFile, seen);
          return false;
        }
        market = retryRecord.market;
        preparedPlan = retryRecord.preparedPlan;
      }
    }
  }

  let eventPlan = preparedPlan ?? await buildEventPlanForMarket(cfg, market, {
    hydrateOdds,
    hydrationSkipReason
  });
  if (preSignedFastTransaction) {
    eventPlan = { ...eventPlan, preSignedFastTransaction };
  }
  let result;
  try {
    result = await executeOrPrint(eventPlan, cfg, runtime);
  } catch (error) {
    markExecutionRetry(retryRecord, cfg, error);
    const row = {
      level: "event-execution-error",
      market: market.address,
      question: market.question,
      message: errorMessage(error),
      retryInMs: cfg.executionRetryMs,
      at: new Date().toISOString()
    };
    appendJsonl(cfg.fillsFile, row);
    console.error(JSON.stringify(row));
    notifyBuyError(cfg, market, error);
    return false;
  }
  appendJsonl(cfg.fillsFile, {
    plan: describeEventPlan(eventPlan),
    result,
    at: new Date().toISOString()
  });
  notifyBuyExecution(cfg, eventPlan, result);
  if (!executionMarksSeen(result)) {
    markExecutionRetry(retryRecord, cfg, new Error(`execution status ${result.status ?? "unknown"}`));
    console.error(JSON.stringify({
      level: "warn",
      source: "single-execution",
      market: market.address,
      message: `Execution not confirmed successful: ${result.status ?? "unknown"}`,
      retryInMs: cfg.executionRetryMs,
      at: new Date().toISOString()
    }));
    return false;
  }
  clearExecutionRetry(retryRecord);
  seen.add(key);
  saveSeen(cfg.stateFile, seen);
  return true;
}

async function buildEventPlan(cfg, args = {}) {
  if (args.market) {
    const market = await fetchMarket(cfg, args.market);
    return buildEventPlanForMarket(cfg, market, args);
  }
  const markets = await loadEventMarkets(cfg, { status: args.market ? "all" : "live" });
  const market = selectEventMarket(markets, args);
  return buildEventPlanForMarket(cfg, market, args);
}

async function buildEventPlanForMarket(cfg, market, args = {}) {
  const curveReason = marketCurveBlockReason(market);
  if (curveReason && !args.ignoreCurveBlock) {
    throw new Error(`Blocked market curve: ${curveReason}`);
  }
  const { publicClient } = makeClients(cfg);
  const hydrateOdds = args.hydrateOdds !== false;
  const planMarket = hydrateOdds
    ? await maybeHydrateMarketOdds(cfg, market)
    : {
        ...market,
        oddsHydrationSkipped: args.hydrationSkipReason ?? "disabled"
      };
  if (args.forceQuoted || args.quoted || cfg.eventBuyMode === "quoted") {
    return quoteBuyAllOutcomes(publicClient, planMarket, cfg, {
      stakePerOutcomeUsdt: args.stakePerOutcomeUsdt ?? cfg.stakePerOutcomeUsdt
    });
  }
  return buildDirectBuyAllOutcomesPlan(planMarket, cfg, {
    stakePerOutcomeUsdt: args.stakePerOutcomeUsdt ?? cfg.stakePerOutcomeUsdt
  });
}

async function loadEventMarkets(
  cfg,
  { status = "live", limit = 500, order = "created_at", ascending = false, eventStatuses = ["live"] } = {}
) {
  const markets = await fetchMarkets(cfg, {
    status,
    topic: "",
    order,
    ascending,
    limit
  });
  notifyBlockedCurveMarkets(cfg, markets, `rest-${status}`);
  return filterEventMarkets(markets, cfg, { statuses: eventStatuses });
}

function notifyBlockedCurveMarkets(cfg, markets, source) {
  for (const market of markets ?? []) {
    const curveReason = marketCurveBlockReason(market);
    if (!curveReason) continue;
    if (!notifyBlockedCurveMarket(cfg, market, curveReason, source)) continue;
    const row = {
      level: "event-skip-curve",
      source,
      market: market.address,
      question: market.question,
      startDate: market.startDate,
      curve: market.curve ?? null,
      curveReason,
      reason: `blocked curve: ${curveReason}`,
      at: new Date().toISOString()
    };
    appendJsonl(cfg.fillsFile, row);
    console.log(JSON.stringify(row));
  }
}

async function loadUpcomingRestEventMarkets(cfg) {
  return loadEventMarkets(cfg, {
    status: "not_started",
    order: "start_timestamp",
    ascending: true,
    limit: Math.max(cfg.watchScanLimit, 100),
    eventStatuses: ["not_started"]
  });
}

async function loadRestDiscoveryEventMarkets(cfg) {
  return loadEventMarkets(cfg, {
    status: "all",
    limit: cfg.watchScanLimit,
    eventStatuses: REST_DISCOVERY_STATUSES
  });
}

async function loadStartupRestEventMarkets(cfg) {
  const [liveMarkets, futureMarkets] = await Promise.all([
    loadEventMarkets(cfg),
    loadUpcomingRestEventMarkets(cfg)
  ]);
  return mergeMarketLists(liveMarkets, futureMarkets);
}

function mergeMarketLists(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const market of list ?? []) {
      if (!market?.address) continue;
      const key = String(market.address).toLowerCase();
      if (!merged.has(key)) {
        merged.set(key, market);
      } else {
        merged.set(key, { ...merged.get(key), ...market });
      }
    }
  }
  return [...merged.values()];
}

async function executeOrPrint(eventPlan, cfg, runtime = null) {
  const described = describeEventPlan(eventPlan);
  if (cfg.dryRun || !cfg.execute) {
    console.log(JSON.stringify({ level: "event-plan", plan: described }, null, 2));
    return { dryRun: true };
  }

  const result = await buyOutcomesBatch(cfg, eventPlan, runtime);
  console.log(JSON.stringify({ level: "executed", plan: described, result }, null, 2));
  maybeTrackReceipt(cfg, result, {
    type: "single",
    market: eventPlan.market.address,
    question: eventPlan.market.question
  });
  return result;
}

async function executeOrPrintBundle(bundle, cfg, runtime = null) {
  const described = describeFastBundlePlan(bundle, { dryRun: cfg.dryRun || !cfg.execute });
  if (cfg.dryRun || !cfg.execute) {
    console.log(JSON.stringify({ level: "event-bundle-plan", bundle: described }, null, 2));
    return { dryRun: true, bundled: true };
  }

  const result = await executeFastBuyBundle(cfg, bundle, runtime);
  console.log(JSON.stringify({ level: "bundle-executed", bundle: described, result }, null, 2));
  maybeTrackReceipt(cfg, result, {
    type: "bundle",
    markets: bundle.markets.map((market) => market.address),
    marketCount: bundle.marketCount,
    outcomeCount: bundle.outcomeCount
  });
  return result;
}

function maybeTrackReceipt(cfg, result, context = {}) {
  if (
    !cfg.asyncReceiptWatch ||
    cfg.dryRun ||
    !cfg.execute ||
    !result?.txHash ||
    result.waitedForReceipt ||
    result.blockNumber
  ) return;

  void trackReceipt(cfg, result.txHash, context).catch((error) => {
    const row = {
      level: "event-receipt",
      status: "error",
      txHash: result.txHash,
      message: errorMessage(error),
      context,
      at: new Date().toISOString()
    };
    appendJsonl(cfg.fillsFile, row);
    console.error(JSON.stringify(row));
    notifyReceipt(cfg, row);
  });
}

async function trackReceipt(cfg, txHash, context) {
  const { publicClient } = makeClients(cfg);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: cfg.receiptWatchTimeoutMs,
    pollingInterval: cfg.receiptWatchPollingMs
  });
  const row = {
    level: "event-receipt",
    status: receipt.status,
    txHash,
    blockNumber: receipt.blockNumber?.toString() ?? null,
    gasUsed: receipt.gasUsed?.toString() ?? null,
    effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null,
    context,
    at: new Date().toISOString()
  };
  appendJsonl(cfg.fillsFile, row);
  console.log(JSON.stringify(row));
  notifyReceipt(cfg, row);
}

function notifyMarketDiscovered(cfg, market, record, source) {
  if (!rememberPersistentMarketNotification(cfg, marketNotificationKey("discovered", market))) return false;
  const plan = record?.preparedPlan;
  const lines = [
    markdownLine("来源", source),
    markdownLine("市场", market.question),
    markdownLine("开盘", market.startDate),
    markdownLine("结束", market.endDate),
    markdownLine("选项", plan?.outcomes?.length ?? market.outcomes?.length),
    markdownLine("计划金额", plan?.totalStakeUsdt ? `${plan.totalStakeUsdt} U` : ""),
    markdownLine("状态", market.status)
  ].filter(Boolean);
  notifyPushPlusSafe(cfg, {
    title: "42space 发现符合策略的新市场",
    content: lines.join("\n")
  });
  return true;
}

function notifyBlockedCurveMarket(cfg, market, curveReason, source) {
  if (!rememberPersistentMarketNotification(cfg, marketNotificationKey("blocked-curve", market, curveReason))) {
    return false;
  }
  const lines = [
    markdownLine("来源", source),
    markdownLine("市场", market.question),
    markdownLine("开盘", market.startDate),
    markdownLine("结束", market.endDate),
    markdownLine("Curve", curveReason),
    markdownLine("动作", "已跳过，不买")
  ].filter(Boolean);
  notifyPushPlusSafe(cfg, {
    title: "42space 跳过风险 Curve 市场",
    content: lines.join("\n")
  });
  return true;
}

function marketNotificationKey(kind, market, detail = "") {
  const identity = String(market?.address ?? market?.question ?? "").trim().toLowerCase();
  if (!identity) return "";
  const suffix = detail ? `:${String(detail).trim().toLowerCase()}` : "";
  return `${kind}:${identity}${suffix}`;
}

function persistentMarketNotifications(cfg) {
  const file = path.resolve(cfg.notificationStateFile);
  let seen = persistentNotificationSets.get(file);
  if (!seen) {
    seen = loadSeen(file);
    persistentNotificationSets.set(file, seen);
  }
  return seen;
}

function hasPersistentMarketNotification(cfg, key) {
  return Boolean(key && persistentMarketNotifications(cfg).has(key));
}

function rememberPersistentMarketNotification(cfg, key) {
  if (!key) return false;
  const seen = persistentMarketNotifications(cfg);
  if (seen.has(key)) return false;
  seen.add(key);
  saveSeen(cfg.notificationStateFile, seen);
  return true;
}

function notifyBuyExecution(cfg, eventPlan, result) {
  if (result?.dryRun) return;
  const status = buyResultText(result);
  const lines = [
    markdownLine("状态", status),
    markdownLine("市场", eventPlan.market?.question),
    markdownLine("金额", eventPlan.totalStakeUsdt ? `${eventPlan.totalStakeUsdt} U` : ""),
    markdownLine("选项", eventPlan.outcomes?.length),
    markdownLine("交易", shortHash(result.txHash)),
    markdownLine("区块", result.blockNumber),
    markdownLine("广播", result.broadcastMode),
    markdownLine("节点数", result.broadcastRpcCount)
  ].filter(Boolean);
  notifyPushPlusSafe(cfg, {
    title: `42space 买入${status}`,
    content: lines.join("\n")
  });
}

function notifyBundleExecution(cfg, bundle, result) {
  if (result?.dryRun) return;
  const status = buyResultText(result);
  const lines = [
    markdownLine("状态", status),
    markdownLine("市场数", bundle.marketCount),
    markdownLine("选项数", bundle.outcomeCount),
    markdownLine("金额", bundle.totalStakeUsdt ? `${bundle.totalStakeUsdt} U` : ""),
    markdownLine("交易", shortHash(result.txHash)),
    markdownLine("区块", result.blockNumber),
    markdownLine("广播", result.broadcastMode),
    ...bundle.markets.slice(0, 6).map((market) => markdownLine("市场", market.question))
  ].filter(Boolean);
  notifyPushPlusSafe(cfg, {
    title: `42space 批量买入${status}`,
    content: lines.join("\n")
  });
}

function notifyBuyError(cfg, market, error) {
  const lines = [
    markdownLine("市场", market.question),
    markdownLine("开盘", market.startDate),
    markdownLine("错误", errorMessage(error).slice(0, 180))
  ].filter(Boolean);
  notifyPushPlusSafe(cfg, {
    title: "42space 买入失败",
    content: lines.join("\n")
  });
}

function notifyReceipt(cfg, row) {
  const lines = [
    markdownLine("状态", row.status),
    markdownLine("交易", shortHash(row.txHash)),
    markdownLine("区块", row.blockNumber),
    markdownLine("Gas", row.gasUsed),
    markdownLine("市场", row.context?.question),
    markdownLine("错误", row.message)
  ].filter(Boolean);
  notifyPushPlusSafe(cfg, {
    title: row.status === "success" ? "42space 交易已确认" : "42space 交易确认异常",
    content: lines.join("\n")
  });
}

function notifyAutoSell(cfg, action, execution) {
  const status = execution?.status ?? action?.status;
  const lines = [
    markdownLine("状态", status),
    markdownLine("市场", action?.question),
    markdownLine("选项", action?.outcome),
    markdownLine("比例", action?.percent ? `${action.percent}%` : ""),
    markdownLine("预计收回", action?.expectedCollateralToUserUsdt ? `${action.expectedCollateralToUserUsdt} U` : ""),
    markdownLine("交易", shortHash(action?.txHash))
  ].filter(Boolean);
  notifyPushPlusSafe(cfg, {
    title: "42space 自动止盈",
    content: lines.join("\n")
  });
}

function buyResultText(result) {
  if (result?.status === "success") return "已确认";
  if (result?.status === "broadcast" && result?.txHash) return "已广播";
  if (result?.status === "reverted") return "链上失败";
  if (result?.txHash) return "已广播";
  return "待确认";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWakeSignal() {
  let wakeCurrent = null;
  return {
    wake() {
      const wake = wakeCurrent;
      wakeCurrent = null;
      wake?.();
    },
    wait(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          if (wakeCurrent === done) wakeCurrent = null;
          resolve();
        }
        if (wakeCurrent) wakeCurrent();
        wakeCurrent = done;
      });
    }
  };
}

async function promptHidden(question) {
  if (process.platform === "darwin" && process.env.NO_GUI_PROMPT !== "1") {
    return promptMacDialog(question, { hidden: true });
  }
  if (process.stdin.isTTY) return promptHiddenTty(question);
  throw new Error("PRIVATE_KEY is required; set it in environment or run from a TTY");
}

async function requireExactConfirmation(question, expected) {
  if (process.platform === "darwin" && process.env.NO_GUI_PROMPT !== "1") {
    await confirmMacDialog(question, expected);
    return;
  }
  const answer = await promptLine(`${question}`);
  if (answer.trim() !== expected) {
    throw new Error(`Confirmation mismatch; expected ${expected}`);
  }
}

async function promptMacDialog(question, { hidden }) {
  const hiddenClause = hidden ? " with hidden answer" : "";
  const script = `text returned of (display dialog ${appleString(question)} default answer ""${hiddenClause} buttons {"取消", "继续"} default button "继续" cancel button "取消")`;
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: 120000,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}

async function confirmMacDialog(question, confirmLabel) {
  const script = `display dialog ${appleString(question)} buttons {"取消", ${appleString(confirmLabel)}} default button ${appleString(confirmLabel)} cancel button "取消"`;
  await execFileAsync("osascript", ["-e", script], {
    timeout: 120000,
    maxBuffer: 1024 * 1024
  });
}

async function promptLine(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function promptHiddenTty(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
    }

    function onData(chunk) {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Interrupted"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function appleString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function nextWatchSleepMs(cfg, pending) {
  const defaultMs = cfg.pollMs;
  if (!pending || pending.size === 0) return defaultMs;

  let minActionWaitMs = Infinity;
  for (const record of pending.values()) {
    minActionWaitMs = Math.min(minActionWaitMs, msUntilRecordAction(record, cfg));
  }
  if (!Number.isFinite(minActionWaitMs)) return defaultMs;
  if (minActionWaitMs <= cfg.preopenHotMs) {
    return Math.max(1, Math.min(defaultMs, cfg.hotPollMs, minActionWaitMs));
  }
  return defaultMs;
}

function msUntilStart(market) {
  const start = new Date(market.startDate).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, start - Date.now());
}

function msUntilAction(market, cfg) {
  const start = new Date(market?.startDate).getTime();
  if (!Number.isFinite(start)) return 0;
  const delayMs = Math.max(0, Number(cfg.eventBuyDelaySeconds ?? 0)) * 1000;
  const prebroadcastMs = Math.max(0, Number(cfg.prebroadcastMs ?? 0));
  return Math.max(0, start + delayMs - prebroadcastMs - Date.now());
}

function msUntilRecordAction(record, cfg) {
  const actionWaitMs = msUntilAction(pendingMarket(record), cfg);
  const retryWaitMs = Math.max(0, Number(record?.executionRetryAfterMs ?? 0) - Date.now());
  const safetyWaitMs = Math.max(0, Number(record?.safetyRetryAfterMs ?? 0) - Date.now());
  return Math.max(actionWaitMs, retryWaitMs, safetyWaitMs);
}

function errorMessage(error) {
  const message = error?.message ?? String(error);
  const cause = error?.cause?.message ? `: ${error.cause.message}` : "";
  return redactSecretUrls(`${message}${cause}`);
}

function wsProviderLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function redactSecretUrls(message) {
  return String(message).replace(/(?:https?|wss?):\/\/[^\s")]+/g, (raw) => {
    try {
      const url = new URL(raw);
      if (/chainstack|ankr|rpc/i.test(url.hostname)) {
        return `${url.protocol}//${url.hostname}/***`;
      }
      return raw;
    } catch {
      return "[redacted-url]";
    }
  });
}

function tempFile(name) {
  return path.join(os.tmpdir(), name);
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "fatal", message: errorMessage(error) }, null, 2));
  process.exitCode = 1;
});
