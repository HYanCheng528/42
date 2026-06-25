import { ADDRESSES } from "./fortytwo.js";

export function filterEventMarkets(markets, cfg, options = {}) {
  return markets
    .filter((market) => isEventMarket(market, cfg, options))
    .filter((market) => passesCreatedAtFloor(market, cfg))
    .sort(compareCreatedAtDesc);
}

export function filterNotificationMarkets(markets, cfg, options = {}) {
  const notificationCfg = {
    ...cfg,
    worldCupScoreMode: false
  };
  return markets
    .filter((market) => isEventMarketBeforeCurveCheck(market, notificationCfg, options))
    .filter((market) => passesCreatedAtFloor(market, notificationCfg))
    .sort(compareCreatedAtDesc);
}

export function isEventMarket(market, cfg, options = {}) {
  if (!isEventMarketBeforeCurveCheck(market, cfg, options)) return false;
  return true;
}

export function isEventMarketBeforeCurveCheck(market, cfg, options = {}) {
  const statuses = options.statuses ?? ["live"];
  if (!market || !statuses.includes(String(market.status ?? ""))) return false;
  if (!Array.isArray(market.outcomes) || market.outcomes.length === 0) return false;
  if (isTestingMarket(market)) return false;
  if (isBlockedMarketAddress(market, cfg)) return false;
  if (isBlockedQuestion(market, cfg)) return false;
  if (!passesOnchainOnlyPolicy(market, cfg)) return false;
  if (isPriceMarket(market, cfg)) return false;
  if (!passesCategoryAllowlist(market, cfg)) return false;
  if (!passesMinimumDuration(market, cfg)) return false;
  if (!passesWorldCupScoreMode(market, cfg)) return false;
  return true;
}

export function isPriceMarket(market, cfg) {
  const categoryText = (market.categories ?? []).join(" ");
  const tagText = (market.tags ?? []).join(" ");
  const haystack = [
    market.question,
    market.slug,
    categoryText,
    tagText,
    ...(market.topics ?? [])
  ]
    .filter(Boolean)
    .join(" ");

  if (containsAny(categoryText, cfg.marketCategoryBlocklist)) return true;
  if (containsAny(tagText, cfg.marketTagBlocklist)) return true;
  if (market.curve && String(market.curve).toLowerCase() === ADDRESSES.clockCurve.toLowerCase()) return true;
  if (market.curve && String(market.curve).toLowerCase() === ADDRESSES.price8hCurve.toLowerCase()) return true;
  return /price\s+range|8\s*hour|clock\s*curve/i.test(haystack);
}

export function selectEventMarket(markets, args = {}) {
  if (args.market) {
    const wanted = String(args.market).toLowerCase();
    const market = markets.find((item) => String(item.address).toLowerCase() === wanted);
    if (!market) throw new Error(`Event market not found: ${args.market}`);
    return market;
  }

  const market = markets[0];
  if (!market) throw new Error("No live Event Market found");
  return market;
}

export function summarizeEventMarket(market) {
  return {
    question: market.question,
    address: market.address,
    status: market.status,
    createdAt: market.createdAt,
    startDate: market.startDate,
    endDate: market.endDate,
    contractVersion: market.contractVersion,
    categories: market.categories ?? [],
    tags: market.tags ?? [],
    outcomeCount: market.outcomes?.length ?? 0,
    outcomes: sortOutcomes(market.outcomes ?? []).map((outcome) => ({
      tokenId: outcome.tokenId,
      name: outcome.name,
      price: outcome.price,
      payout: outcome.payout,
      volume: outcome.volume,
      mintedQuantity: outcome.mintedQuantity
    }))
  };
}

export function eventSeenKey(market, cfg) {
  const selection = cfg.eventOutcomeSelection === "all"
    ? "all"
    : `${cfg.eventOutcomeSelection}-${cfg.eventOutcomeCount}`;
  return `${String(market.address).toLowerCase()}:event-${selection}:${cfg.stakePerOutcomeUsdt}`;
}

function passesCategoryAllowlist(market, cfg) {
  if (!cfg.marketCategoryAllowlist || cfg.marketCategoryAllowlist.length === 0) return true;
  return containsAny((market.categories ?? []).join(" "), cfg.marketCategoryAllowlist);
}

function isBlockedQuestion(market, cfg) {
  return containsAny(market.question ?? "", cfg.marketQuestionBlocklist);
}

export function isTestingMarket(market) {
  return /\btesting\b/i.test([
    market?.question,
    market?.slug
  ].filter(Boolean).join(" "));
}

export function isBlockedMarketAddress(market, cfg) {
  const address = normalizeAddress(market?.address);
  if (!address) return false;
  const blocked = new Set((cfg.marketAddressBlocklist ?? []).map(normalizeAddress).filter(Boolean));
  return blocked.has(address);
}

function passesOnchainOnlyPolicy(market, cfg) {
  if (cfg.allowOnchainOnlyMarkets) return true;
  const tags = (market.tags ?? []).map((tag) => String(tag).toLowerCase());
  const categories = market.categories ?? [];
  const onchainOnly = tags.includes("onchain") && !market.oddsHydratedFrom && categories.length === 0;
  return !onchainOnly;
}

function passesCreatedAtFloor(market, cfg) {
  if (!cfg.minMarketCreatedAt) return true;
  const createdAt = new Date(market.createdAt).getTime();
  const floor = new Date(cfg.minMarketCreatedAt).getTime();
  return Number.isFinite(createdAt) && Number.isFinite(floor) && createdAt >= floor;
}

export function marketDurationHours(market) {
  const start = new Date(market?.startDate).getTime();
  const end = new Date(market?.endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 3600000;
}

export function passesMinimumDuration(market, cfg) {
  const minimumHours = Number(cfg.minMarketDurationHours ?? 0);
  if (!Number.isFinite(minimumHours) || minimumHours <= 0) return true;
  const durationHours = marketDurationHours(market);
  return durationHours !== null && durationHours >= minimumHours;
}

export function passesWorldCupScoreMode(market, cfg) {
  if (!cfg.worldCupScoreMode) return true;
  return isWorldCupScoreMarket(market);
}

export function isWorldCupScoreMarket(market) {
  if (!Array.isArray(market?.outcomes) || market.outcomes.length !== 25) return false;
  const text = [
    market.question,
    market.slug,
    ...(market.categories ?? []),
    ...(market.tags ?? []),
    ...(market.topics ?? [])
  ].filter(Boolean).join(" ");
  if (!/(^|\s)(vs\.?|v)(\s|$)/i.test(text) && !/world\s*cup|fifa/i.test(text)) return false;

  const scoreLikeCount = market.outcomes
    .map(outcomeLabel)
    .filter(isScoreOutcomeLabel)
    .length;
  return scoreLikeCount >= 15;
}

function outcomeLabel(outcome) {
  if (!outcome || typeof outcome !== "object") return String(outcome ?? "");
  return [outcome.name, outcome.label, outcome.title, outcome.symbol].filter(Boolean).join(" ");
}

function isScoreOutcomeLabel(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(.{2,48}?)\s+\d+\s*(?:-|[^0-9A-Za-z\s])\s*\d+\s+(.{2,48})$/u);
  return Boolean(match && /[A-Za-z]/.test(match[1]) && /[A-Za-z]/.test(match[2]));
}

function containsAny(text, needles = []) {
  const normalized = String(text ?? "").toLowerCase();
  return needles.some((needle) => normalized.includes(String(needle).toLowerCase()));
}

function normalizeAddress(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(text) ? text : "";
}

function compareCreatedAtDesc(a, b) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function sortOutcomes(outcomes) {
  return [...outcomes].sort((a, b) => Number(BigInt(a.tokenId) - BigInt(b.tokenId)));
}
