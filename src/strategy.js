import { estimateFuturesDailyQuoteVolume, getSpotPrice } from "./binance.js";

export function filterTargetMarkets(markets, cfg) {
  return markets.filter((market) => {
    const haystack = [
      market.question,
      market.slug,
      market.description,
      ...(market.categories ?? []),
      ...(market.subcategories ?? []),
      ...(market.topics ?? []),
      ...(market.tags ?? [])
    ]
      .filter(Boolean)
      .join(" ");

    if (cfg.targetQuestionRegex && !cfg.targetQuestionRegex.test(haystack)) return false;
    if (!/BTC|Bitcoin/i.test(haystack)) return false;
    if (!Array.isArray(market.outcomes) || market.outcomes.length === 0) return false;
    return looksLikeRangeMarket(market);
  });
}

export function isInOpenBuyWindow(market, cfg, now = new Date()) {
  if (market.status !== "live") return false;

  const start = new Date(market.startDate).getTime();
  const end = new Date(market.endDate).getTime();
  const t = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (t < start) return false;
  if (t >= end) return false;
  if (cfg.allowLateBuy) return true;
  return t - start <= cfg.openWindowSeconds * 1000;
}

export function isUpcomingSoon(market, cfg, now = new Date()) {
  const start = new Date(market.startDate).getTime();
  const t = now.getTime();
  return Number.isFinite(start) && start > t && start - t <= cfg.lookaheadSeconds * 1000;
}

export async function buildPlan(market, cfg, overrides = {}) {
  const strategy = overrides.strategy ?? cfg.strategy;
  const stakeUsdt = Number(overrides.stakeUsdt ?? cfg.stakeUsdt);
  const outcome = await selectOutcome(market, cfg, strategy, overrides);

  return {
    dryRun: cfg.dryRun || !cfg.execute,
    strategy,
    market,
    outcome,
    stakeUsdt,
    slippageBps: cfg.slippageBps,
    reason: outcome.selectionReason,
    source: outcome.selectionSource ?? null,
    createdAt: new Date().toISOString()
  };
}

export async function selectOutcome(market, cfg, strategy, overrides = {}) {
  if (overrides.tokenId) {
    const outcome = market.outcomes.find((item) => String(item.tokenId) === String(overrides.tokenId));
    if (!outcome) throw new Error(`Token id ${overrides.tokenId} not found in market outcomes`);
    return mark(outcome, "manual token id", null);
  }

  if (cfg.targetOutcomeRegex) {
    const outcome = market.outcomes.find((item) => cfg.targetOutcomeRegex.test(outcomeText(item)));
    if (outcome) return mark(outcome, "matched TARGET_OUTCOME_REGEX", null);
    if (strategy === "configured") throw new Error("No outcome matched TARGET_OUTCOME_REGEX");
  }

  if (strategy === "binance_volume_projection") {
    const estimate = await estimateFuturesDailyQuoteVolume("BTCUSDT");
    const parsed = market.outcomes
      .map((outcome) => ({ outcome, range: parseMoneyRange(outcomeText(outcome)) }))
      .filter((item) => item.range);

    const containing = parsed.find((item) =>
      estimate.estimatedDailyVolume >= item.range.min && estimate.estimatedDailyVolume < item.range.max
    );
    if (containing) {
      return mark(
        containing.outcome,
        `estimated Binance daily quote volume ${formatUsd(estimate.estimatedDailyVolume)} falls in range`,
        estimate
      );
    }

    if (parsed.length > 0) {
      const closest = parsed
        .map((item) => ({
          ...item,
          distance: distanceToRange(estimate.estimatedDailyVolume, item.range)
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      return mark(
        closest.outcome,
        `closest range to estimated Binance daily quote volume ${formatUsd(estimate.estimatedDailyVolume)}`,
        estimate
      );
    }
  }

  if (strategy === "binance_price_projection") {
    const priceTick = await getSpotPrice("BTCUSDT");
    const parsed = market.outcomes
      .map((outcome) => ({ outcome, range: parseMoneyRange(outcomeText(outcome)) }))
      .filter((item) => item.range);

    const containing = parsed.find((item) => priceTick.price >= item.range.min && priceTick.price < item.range.max);
    if (containing) {
      return mark(containing.outcome, `current Binance spot price ${formatUsd(priceTick.price)} falls in range`, priceTick);
    }

    if (parsed.length > 0) {
      const closest = parsed
        .map((item) => ({ ...item, distance: distanceToRange(priceTick.price, item.range) }))
        .sort((a, b) => a.distance - b.distance)[0];
      return mark(closest.outcome, `closest range to current Binance spot price ${formatUsd(priceTick.price)}`, priceTick);
    }
  }

  const cheapest = [...market.outcomes].sort((a, b) => Number(a.price ?? Infinity) - Number(b.price ?? Infinity))[0];
  return mark(cheapest, "cheapest current outcome price", null);
}

export function summarizeMarket(market) {
  return {
    question: market.question,
    address: market.address,
    status: market.status,
    startDate: market.startDate,
    endDate: market.endDate,
    contractVersion: market.contractVersion,
    elapsedPct: market.elapsedPct,
    volume: market.volume,
    traders: market.traders,
    outcomes: (market.outcomes ?? []).map((outcome) => ({
      tokenId: outcome.tokenId,
      name: outcome.name,
      price: outcome.price,
      payout: outcome.payout,
      volume: outcome.volume,
      mintedQuantity: outcome.mintedQuantity
    }))
  };
}

function looksLikeRangeMarket(market) {
  const outcomes = market.outcomes ?? [];
  return outcomes.some((outcome) => parseMoneyRange(outcomeText(outcome))) || /range|volume|price/i.test(market.question ?? "");
}

function outcomeText(outcome) {
  return [outcome.name, outcome.symbol].filter(Boolean).join(" ");
}

function mark(outcome, selectionReason, selectionSource) {
  return {
    ...outcome,
    selectionReason,
    selectionSource
  };
}

function parseMoneyRange(text) {
  const normalized = text.replace(/[,$]/g, "").replace(/\s+/g, " ").trim();
  const below = normalized.match(/(?:below|under|<|less than)\s*([0-9]+(?:\.[0-9]+)?)\s*([KMBT])?/i);
  if (below) {
    return { min: 0, max: scaleNumber(below[1], below[2]) };
  }

  const above = normalized.match(/(?:above|over|>|greater than)\s*([0-9]+(?:\.[0-9]+)?)\s*([KMBT])?/i);
  if (above) {
    return { min: scaleNumber(above[1], above[2]), max: Number.POSITIVE_INFINITY };
  }

  const range = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*([KMBT])?\s*(?:-|to|–|—)\s*([0-9]+(?:\.[0-9]+)?)\s*([KMBT])?/i);
  if (!range) return null;

  const leftUnit = range[2] || range[4];
  const rightUnit = range[4] || range[2];
  return {
    min: scaleNumber(range[1], leftUnit),
    max: scaleNumber(range[3], rightUnit)
  };
}

function scaleNumber(value, unit = "") {
  const n = Number(value);
  const u = unit.toUpperCase();
  if (u === "K") return n * 1e3;
  if (u === "M") return n * 1e6;
  if (u === "B") return n * 1e9;
  if (u === "T") return n * 1e12;
  return n;
}

function distanceToRange(value, range) {
  if (value < range.min) return range.min - value;
  if (value >= range.max) return value - range.max;
  return 0;
}

function formatUsd(value) {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(2)}`;
}
