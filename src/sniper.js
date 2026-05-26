#!/usr/bin/env node

import { appendJsonl, loadSeen, parseArgs, readConfig, saveSeen } from "./config.js";
import { buyOutcome, describePlan, fetchMarkets } from "./fortytwo.js";
import {
  buildPlan,
  filterTargetMarkets,
  isInOpenBuyWindow,
  isUpcomingSoon,
  summarizeMarket
} from "./strategy.js";

async function main() {
  const [command = "scan", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const cfg = readConfig();

  if (command === "scan") {
    await scan(cfg);
    return;
  }
  if (command === "watch") {
    await watch(cfg);
    return;
  }
  if (command === "buy") {
    await manualBuy(cfg, args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function scan(cfg) {
  const markets = filterTargetMarkets(await fetchMarkets(cfg, { status: "all" }), cfg);
  const shown = markets.slice(0, cfg.scanLimit);
  console.log(
    JSON.stringify(
      {
        found: markets.length,
        shown: shown.length,
        markets: shown.map(summarizeMarket)
      },
      null,
      2
    )
  );

  if (shown.length > 0) {
    const plan = await buildPlan(shown[0], cfg);
    console.log("\nPlan for newest target market:");
    console.log(JSON.stringify(describePlan(plan), null, 2));
  }
}

async function watch(cfg) {
  const seen = loadSeen(cfg.stateFile);
  console.log(
    JSON.stringify(
      {
        mode: cfg.dryRun || !cfg.execute ? "dry-run" : "execute",
        strategy: cfg.strategy,
        stakeUsdt: cfg.stakeUsdt,
        openWindowSeconds: cfg.openWindowSeconds,
        pollMs: cfg.pollMs
      },
      null,
      2
    )
  );

  while (true) {
    try {
      const markets = filterTargetMarkets(await fetchMarkets(cfg, { status: "all" }), cfg);
      await handleMarkets(markets, cfg, seen);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: error.message, at: new Date().toISOString() }));
    }
    await sleep(cfg.pollMs);
  }
}

async function manualBuy(cfg, args) {
  if (!args.market || !args.tokenId) {
    throw new Error("Usage: npm run buy -- --market 0x... --token-id 32 [--stake-usdt 5]");
  }

  const markets = await fetchMarkets(cfg, { status: "all", topic: "" });
  const market = markets.find((item) => item.address.toLowerCase() === String(args.market).toLowerCase());
  if (!market) throw new Error(`Market not found through 42 REST: ${args.market}`);

  const plan = await buildPlan(market, cfg, {
    tokenId: args.tokenId,
    stakeUsdt: args.stakeUsdt ?? cfg.stakeUsdt,
    strategy: "manual"
  });
  await executeOrPrint(plan, cfg);
}

async function handleMarkets(markets, cfg, seen) {
  const now = new Date();
  const upcoming = markets.filter((market) => isUpcomingSoon(market, cfg, now));
  const openNow = markets.filter((market) => isInOpenBuyWindow(market, cfg, now));

  if (upcoming.length > 0) {
    console.log(
      JSON.stringify({
        level: "info",
        at: now.toISOString(),
        upcoming: upcoming.map((market) => ({
          question: market.question,
          address: market.address,
          startDate: market.startDate
        }))
      })
    );
  }

  for (const market of openNow) {
    const key = `${market.address.toLowerCase()}:${cfg.strategy}:${cfg.stakeUsdt}`;
    if (seen.has(key)) continue;

    const plan = await buildPlan(market, cfg);
    const result = await executeOrPrint(plan, cfg);
    appendJsonl(cfg.fillsFile, { plan: describePlan(plan), result, at: new Date().toISOString() });
    seen.add(key);
    saveSeen(cfg.stateFile, seen);
  }
}

async function executeOrPrint(plan, cfg) {
  const described = describePlan(plan);
  if (cfg.dryRun || !cfg.execute) {
    console.log(JSON.stringify({ level: "plan", plan: described }, null, 2));
    return { dryRun: true };
  }

  const result = await buyOutcome(cfg, plan);
  console.log(JSON.stringify({ level: "executed", plan: described, result }, null, 2));
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
