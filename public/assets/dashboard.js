const ROUTES = {
  overview: {
    kicker: "Today",
    title: "Overview",
    lead: "判断当前 bot 是否需要人工干预。"
  },
  markets: {
    kicker: "Discovery",
    title: "Markets",
    lead: "查看新盘、待开盘队列和 bot 的买入决策。"
  },
  positions: {
    kicker: "Portfolio",
    title: "Positions",
    lead: "管理 bot wallet 当前持仓，并按比例报价卖出。"
  },
  execution: {
    kicker: "Audit",
    title: "Execution",
    lead: "复盘链上活动、本地执行结果和失败原因。"
  },
  strategy: {
    kicker: "Preflight",
    title: "Strategy",
    lead: "检查 watch config、资金状态和实盘前置条件。"
  }
};

const state = {
  data: null,
  route: routeFromHash(),
  marketFilter: "all",
  configDirty: false,
  configRendered: false,
  configGroup: "buy",
  selected: null,
  sellPercent: 100,
  quickSell: false,
  quickSellMinOutUsdt: "0.000001",
  quoteRequest: 0,
  quoteTimer: null,
  timer: null,
  positionsFastRefresh: false,
  positionsTimer: null,
  positionsLoading: false,
  positionsPendingForce: false,
  lastRefreshMs: null,
  lastPositionsRefreshMs: null,
  overviewLoading: false,
  overviewPendingForce: false,
  walletDataGeneration: 0,
  marketDiagnostics: {},
  operatorApprovals: {},
  outcomeSelectorMarket: null,
  outcomeDrafts: {},
  outcomeSaving: {},
  walletSwitching: false
};

const ICONS = {
  activity: `<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>`,
  "badge-dollar-sign": `<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"></path><path d="M12 7v10"></path><path d="M15 9.5A3.5 3.5 0 0 0 12 8a2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 1 0 5 3.5 3.5 0 0 1-3-1.5"></path>`,
  "bar-chart-3": `<path d="M3 3v18h18"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path>`,
  "calendar-clock": `<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h5"></path><circle cx="16" cy="16" r="6"></circle><path d="M16 14v2l1.5 1.5"></path>`,
  "circle-dollar-sign": `<circle cx="12" cy="12" r="10"></circle><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path><path d="M12 18V6"></path>`,
  clock: `<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>`,
  "key-round": `<path d="M2 18v3h3l7.4-7.4"></path><circle cx="15.5" cy="8.5" r="5.5"></circle><path d="m14 10 2-2"></path>`,
  "loader-circle": `<path d="M21 12a9 9 0 1 1-6.219-8.56"></path>`,
  "layers-3": `<path d="m12 2 9 5-9 5-9-5 9-5Z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 17 9 5 9-5"></path>`,
  radio: `<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"></path><path d="M7.8 16.2a6 6 0 0 1 0-8.5"></path><circle cx="12" cy="12" r="2"></circle><path d="M16.2 7.8a6 6 0 0 1 0 8.5"></path><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"></path>`,
  receipt: `<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"></path><path d="M16 8h-6"></path><path d="M16 12h-6"></path><path d="M10 16h4"></path>`,
  "refresh-cw": `<path d="M3 12a9 9 0 0 1 15.2-6.4L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15.2 6.4L3 16"></path><path d="M3 21v-5h5"></path>`,
  save: `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8A2 2 0 0 1 21 8.8V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M17 21v-7H7v7"></path><path d="M7 3v5h8"></path>`,
  send: `<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>`,
  "shield-check": `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.68 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>`,
  "sliders-horizontal": `<line x1="21" x2="14" y1="4" y2="4"></line><line x1="10" x2="3" y1="4" y2="4"></line><line x1="21" x2="12" y1="12" y2="12"></line><line x1="8" x2="3" y1="12" y2="12"></line><line x1="21" x2="16" y1="20" y2="20"></line><line x1="12" x2="3" y1="20" y2="20"></line><line x1="14" x2="14" y1="2" y2="6"></line><line x1="8" x2="8" y1="10" y2="14"></line><line x1="16" x2="16" y1="18" y2="22"></line>`,
  sparkles: `<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path>`,
  timer: `<line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle>`,
  "trending-up": `<path d="m22 7-8.5 8.5-5-5L2 17"></path><path d="M16 7h6v6"></path>`,
  wallet: `<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"></path><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"></path>`,
  x: `<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>`
};

const $ = (id) => document.getElementById(id);

const els = {
  updated: $("updated"),
  refreshBtn: $("refreshBtn"),
  fastRefresh: $("fastRefresh"),
  positionRefresh: $("positionRefresh"),
  positionFastRefresh: $("positionFastRefresh"),
  positionUpdated: $("positionUpdated"),
  viewKicker: $("viewKicker"),
  viewTitle: $("viewTitle"),
  viewLead: $("viewLead"),
  botState: $("botState"),
  fundingState: $("fundingState"),
  nextClock: $("nextClock"),
  newMarketCount: $("newMarketCount"),
  newMarketList: $("newMarketList"),
  nextCount: $("nextCount"),
  upcomingList: $("upcomingList"),
  holdingCount: $("holdingCount"),
  holdingsList: $("holdingsList"),
  positionSummary: $("positionSummary"),
  projectCount: $("projectCount"),
  projectStats: $("projectStats"),
  buySpeedList: $("buySpeedList"),
  activityList: $("activityList"),
  attentionList: $("attentionList"),
  overviewSnapshot: $("overviewSnapshot"),
  overviewNextAction: $("overviewNextAction"),
  overviewActivityMini: $("overviewActivityMini"),
  stakeText: $("stakeText"),
  windowText: $("windowText"),
  autoSellText: $("autoSellText"),
  configFileText: $("configFileText"),
  configForm: $("configForm"),
  restartWatch: $("restartWatch"),
  restartStatus: $("restartStatus"),
  saveConfig: $("saveConfig"),
  preflightList: $("preflightList"),
  approveAmount: $("approveAmount"),
  approveRouter: $("approveRouter"),
  approveStatus: $("approveStatus"),
  sellDrawer: $("sellDrawer"),
  sellBackdrop: $("sellBackdrop"),
  closeDialog: $("closeDialog"),
  sellTitle: $("sellTitle"),
  sellOutcome: $("sellOutcome"),
  sellContext: $("sellContext"),
  sellPercentText: $("sellPercentText"),
  sellPercentRange: $("sellPercentRange"),
  sellPercentInput: $("sellPercentInput"),
  quickSellBox: $("quickSellBox"),
  quickSell: $("quickSell"),
  quickSellMinOut: $("quickSellMinOut"),
  quoteBox: $("quoteBox"),
  quoteRefresh: $("quoteRefresh"),
  confirmSell: $("confirmSell"),
  toast: $("toast")
};

renderStaticIcons();
bindNavigation();
bindSellControls();
bindConfigControls();
bindApprovalControls();
setRoute(state.route, { replace: true });

els.refreshBtn.addEventListener("click", () => loadOverview({ force: true }));
if (els.fastRefresh) els.fastRefresh.hidden = true;
els.positionRefresh?.addEventListener("click", () => loadPositions({ force: true }));
els.positionFastRefresh?.addEventListener("click", () => setPositionsFastRefresh(!state.positionsFastRefresh));
window.addEventListener("hashchange", () => setRoute(routeFromHash(), { replace: true }));

const BUY_ENTRY_MODES = [
  {
    id: "instant",
    label: "0s 抢买",
    tone: "danger",
    description: "开盘即广播，和早期抢买逻辑一致，不等 REST live 或报价模拟。",
    params: ["延迟 0s", "不要求 REST live", "不报价", "允许链上未确认盘", "赔率缺失用 token 顺序"],
    values: {
      EVENT_OPEN_WINDOW_SECONDS: "25",
      EVENT_BUY_DELAY_SECONDS: "0",
      REQUIRE_REST_BEFORE_BUY: false,
      REQUIRE_REST_STATUS: "",
      REQUIRE_QUOTE_BEFORE_BUY: false,
      REQUIRE_CHAIN_MINT_BEFORE_BUY: false,
      ALLOW_ONCHAIN_ONLY_MARKETS: true,
      EVENT_OUTCOME_SELECTION_FALLBACK: "token_order",
      ARM_CATCH_UP_AFTER_FUNDING: false,
      ARM_CATCH_UP_WINDOW_MS: "0"
    }
  },
  {
    id: "anti",
    label: "反狙击安全门",
    tone: "safe",
    description: "等待开盘后的安全窗口，到点只买 REST 已变 live 的市场。",
    params: ["默认延迟 20s", "要求 REST live", "不买链上未确认盘", "赔率缺失直接跳过", "不做 60s 补追"],
    values: {
      EVENT_OPEN_WINDOW_SECONDS: "25",
      EVENT_BUY_DELAY_SECONDS: "20",
      REQUIRE_REST_BEFORE_BUY: true,
      REQUIRE_REST_STATUS: "live",
      REQUIRE_QUOTE_BEFORE_BUY: false,
      REQUIRE_CHAIN_MINT_BEFORE_BUY: false,
      ALLOW_ONCHAIN_ONLY_MARKETS: false,
      EVENT_OUTCOME_SELECTION_FALLBACK: "error",
      ARM_CATCH_UP_AFTER_FUNDING: false,
      ARM_CATCH_UP_WINDOW_MS: "0"
    }
  }
];

const CONFIG_GROUPS = [
  {
    id: "safety",
    label: "安全/实盘",
    description: "实盘开关和确认项",
    sections: [
      {
        title: "交易权限",
        fields: [
          { key: "WALLET_ADDRESS", label: "钱包地址", type: "address" },
          { key: "DRY_RUN", label: "模拟交易", type: "boolean" },
          { key: "EXECUTE", label: "允许真实下单", type: "boolean", danger: true },
          { key: "I_UNDERSTAND_42_PRICE_MARKET_RISK", label: "确认交易风险", type: "ack", danger: true },
          { key: "I_AM_NOT_IN_RESTRICTED_JURISDICTION", label: "确认地区合规", type: "ack", danger: true }
        ]
      }
    ]
  },
  {
    id: "buy",
    label: "买入策略",
    description: "仓位、筛选和 outcome 选择",
    sections: [
      {
        title: "仓位",
        fields: [
          { key: "STAKE_PER_OUTCOME_USDT", label: "每档金额 U", type: "number", min: "0.01", step: "0.01" },
          { key: "EVENT_OUTCOME_COUNT", label: "买入档数", type: "number", min: "1", step: "1" },
          { key: "MAX_STAKE_USDT", label: "单档上限 U", type: "number", min: "0.01", step: "0.01" },
          { key: "MAX_MARKET_STAKE_USDT", label: "单场上限 U", type: "number", min: "0.01", step: "0.01" },
          { key: "MAX_BATCH_STAKE_USDT", label: "批次上限 U", type: "number", min: "0.01", step: "0.01" }
        ]
      },
      {
        title: "入场模式",
        custom: "buyEntryMode"
      },
      {
        title: "入场参数",
        fields: [
          { key: "EVENT_OPEN_WINDOW_SECONDS", label: "开盘容错截止秒", type: "number", min: "1", step: "1" },
          { key: "EVENT_BUY_DELAY_SECONDS", label: "开盘后延迟买入秒", type: "number", min: "0", step: "0.1" },
          { key: "REQUIRE_REST_BEFORE_BUY", label: "买前要求 REST 同步", type: "boolean" },
          { key: "REQUIRE_REST_STATUS", label: "允许 REST 状态", type: "text" },
          { key: "REQUIRE_QUOTE_BEFORE_BUY", label: "买前报价模拟", type: "boolean" },
          { key: "REQUIRE_CHAIN_MINT_BEFORE_BUY", label: "要求已有链上成交", type: "boolean", danger: true },
          { key: "ALLOW_ONCHAIN_ONLY_MARKETS", label: "允许链上未确认盘", type: "boolean", danger: true },
          { key: "ARM_CATCH_UP_AFTER_FUNDING", label: "资金恢复补追", type: "boolean", danger: true },
          { key: "ARM_CATCH_UP_WINDOW_MS", label: "补追窗口 ms", type: "number", min: "0", step: "1000" }
        ]
      },
      {
        title: "市场筛选",
        fields: [
          { key: "MIN_MARKET_DURATION_HOURS", label: "最小时长 h", type: "number", min: "0", step: "0.1" },
          { key: "WORLD_CUP_SCORE_MODE", label: "世界杯25项比分盘模式", type: "boolean" },
          { key: "MARKET_ADDRESS_BLOCKLIST", label: "手动去除市场地址", type: "text" },
          { key: "MARKET_QUESTION_BLOCKLIST", label: "手动去除关键词", type: "text" },
          { key: "WATCH_BUY_EXISTING", label: "启动买现有场", type: "boolean" }
        ]
      },
      {
        title: "买入方式",
        fields: [
          { key: "EVENT_BUY_MODE", label: "买入模式", type: "select", options: ["fast", "quoted"] },
          { key: "EVENT_OUTCOME_SELECTION", label: "选择策略", type: "select", options: ["lowest_odds", "last_outcomes", "all"] },
          { key: "EVENT_OUTCOME_SELECTION_FALLBACK", label: "赔率缺失兜底", type: "select", options: ["token_order", "error"] }
        ]
      }
    ]
  },
  {
    id: "sell",
    label: "卖出策略",
    description: "各策略可同时开启，触发任意一个就卖",
    sections: [
      {
        title: "总开关",
        fields: [
          { key: "AUTO_APPROVE_MARKET_AFTER_BUY", label: "买入后自动卖出授权", type: "boolean" },
          { key: "AUTO_SELL_ENABLED", label: "自动卖出总开关", type: "boolean" },
          { key: "AUTO_SELL_POLL_MS", label: "止盈轮询 ms", type: "number", min: "1", step: "100" },
          { key: "AUTO_SELL_MIN_OUT_MODE", label: "止盈 minOut", type: "select", options: ["quote", "manual"] },
          { key: "AUTO_SELL_MANUAL_MIN_OUT_USDT", label: "手动 minOut U", type: "number", min: "0", step: "0.000001" }
        ]
      },
      {
        title: "原倍数止盈",
        fields: [
          { key: "AUTO_SELL_ORIGINAL_ENABLED", label: "启用原倍数止盈", type: "boolean" },
          { key: "AUTO_SELL_PROFIT_MULTIPLIER", label: "止盈倍数", type: "number", min: "1.01", step: "0.01" },
          { key: "AUTO_SELL_PERCENT", label: "卖出 %", type: "number", min: "1", max: "100", step: "1" }
        ]
      },
      {
        title: "固定移动止盈",
        fields: [
          { key: "AUTO_SELL_FIXED_TRAILING_ENABLED", label: "启用固定移动止盈", type: "boolean" },
          { key: "AUTO_SELL_TRAILING_START_DELAY_SECONDS", label: "延迟触发秒", type: "number", min: "0", step: "1" },
          { key: "AUTO_SELL_TRAILING_ARM_PROFIT_PCT", label: "启动盈利 %", type: "number", min: "0", step: "0.1" },
          { key: "AUTO_SELL_TRAILING_DRAWDOWN_PCT", label: "峰值回撤 %", type: "number", min: "0.01", max: "100", step: "0.1" },
          { key: "AUTO_SELL_TRAILING_PERCENT", label: "卖出 %", type: "number", min: "1", max: "100", step: "1" }
        ]
      },
      {
        title: "自适应移动止盈",
        fields: [
          { key: "AUTO_SELL_ADAPTIVE_TRAILING_ENABLED", label: "启用自适应移动止盈", type: "boolean" },
          { key: "AUTO_SELL_ADAPTIVE_START_DELAY_SECONDS", label: "延迟触发秒", type: "number", min: "0", step: "1" },
          { key: "AUTO_SELL_ADAPTIVE_ARM_PROFIT_PCT", label: "启动盈利 %", type: "number", min: "0", step: "0.1" },
          { key: "AUTO_SELL_ADAPTIVE_PERCENT", label: "卖出 %", type: "number", min: "1", max: "100", step: "1" }
        ]
      },
      {
        title: "自适应高级参数",
        collapsible: true,
        fields: [
          { key: "AUTO_SELL_ADAPTIVE_EARLY_SECONDS", label: "早期固定秒", type: "number", min: "0", step: "1" },
          { key: "AUTO_SELL_ADAPTIVE_EARLY_DRAWDOWN_PCT", label: "早期回撤 %", type: "number", min: "0.01", max: "100", step: "0.1" },
          { key: "AUTO_SELL_ADAPTIVE_WINDOW_SECONDS", label: "波动窗口秒", type: "number", min: "0", step: "1" },
          { key: "AUTO_SELL_ADAPTIVE_MIN_SAMPLES", label: "最少样本", type: "number", min: "1", step: "1" },
          { key: "AUTO_SELL_ADAPTIVE_SMALL_JUMP_PCT", label: "小波动跳动 %", type: "number", min: "0", step: "0.1" },
          { key: "AUTO_SELL_ADAPTIVE_SMALL_RANGE_PCT", label: "小波动振幅 %", type: "number", min: "0", step: "0.1" },
          { key: "AUTO_SELL_ADAPTIVE_SMALL_DRAWDOWN_PCT", label: "小波动回撤 %", type: "number", min: "0.01", max: "100", step: "0.1" },
          { key: "AUTO_SELL_ADAPTIVE_NORMAL_DRAWDOWN_PCT", label: "正常波动回撤 %", type: "number", min: "0.01", max: "100", step: "0.1" },
          { key: "AUTO_SELL_ADAPTIVE_LARGE_JUMP_PCT", label: "大波动跳动 %", type: "number", min: "0", step: "0.1" },
          { key: "AUTO_SELL_ADAPTIVE_LARGE_RANGE_PCT", label: "大波动振幅 %", type: "number", min: "0", step: "0.1" },
          { key: "AUTO_SELL_ADAPTIVE_LARGE_DRAWDOWN_PCT", label: "大波动回撤 %", type: "number", min: "0.01", max: "100", step: "0.1" }
        ]
      },
      {
        title: "弱势超时退出",
        fields: [
          { key: "AUTO_SELL_WEAK_EXIT_ENABLED", label: "启用弱势超时退出", type: "boolean" },
          { key: "AUTO_SELL_WEAK_EXIT_AFTER_OPEN_SECONDS", label: "超时检查秒", type: "number", min: "0", step: "1" },
          { key: "AUTO_SELL_WEAK_EXIT_MIN_PEAK_PROFIT_PCT", label: "需达到峰值盈利 %", type: "number", min: "0", step: "0.1" },
          { key: "AUTO_SELL_WEAK_EXIT_MAX_CURRENT_PROFIT_PCT", label: "当前盈利低于 %", type: "number", min: "-100", step: "0.1" },
          { key: "AUTO_SELL_WEAK_EXIT_PERCENT", label: "卖出 %", type: "number", min: "1", max: "100", step: "1" }
        ]
      },
      {
        title: "保本回落卖出",
        fields: [
          { key: "AUTO_SELL_BREAKEVEN_ENABLED", label: "启用保本回落卖出", type: "boolean" },
          { key: "AUTO_SELL_BREAKEVEN_START_DELAY_SECONDS", label: "延迟触发秒", type: "number", min: "0", step: "1" },
          { key: "AUTO_SELL_BREAKEVEN_ARM_PROFIT_PCT", label: "启动盈利 %", type: "number", min: "0", step: "0.1" },
          { key: "AUTO_SELL_BREAKEVEN_EXIT_PROFIT_PCT", label: "回落到盈利 %", type: "number", min: "-100", step: "0.1" },
          { key: "AUTO_SELL_BREAKEVEN_PERCENT", label: "卖出 %", type: "number", min: "1", max: "100", step: "1" }
        ]
      },
      {
        title: "开盘定时极速卖出",
        fields: [
          { key: "AUTO_SELL_TIMED_EXIT_ENABLED", label: "启用定时极速卖出", type: "boolean" },
          { key: "AUTO_SELL_TIMED_EXIT_AFTER_OPEN_SECONDS", label: "开盘后秒数", type: "number", min: "0", step: "1" },
          { key: "AUTO_SELL_TIMED_EXIT_PERCENT", label: "卖出 %", type: "number", min: "1", max: "100", step: "1" }
        ]
      }
    ]
  },
  {
    id: "advanced",
    label: "高级",
    description: "数据源、Gas 和扫描参数",
    sections: [
      {
        title: "执行参数",
        fields: [
          { key: "GAS_PRICE_GWEI", label: "买入 Gas gwei", type: "number", min: "0.01", step: "0.01" },
          { key: "SELL_GAS_PRICE_GWEI", label: "卖出 Gas gwei", type: "number", min: "0.01", step: "0.01" },
          { key: "OPERATOR_APPROVE_GAS_PRICE_GWEI", label: "卖出授权 Gas gwei", type: "number", min: "0.01", step: "0.01" },
          { key: "SLIPPAGE_BPS", label: "报价滑点 bps", type: "number", min: "0", max: "5000", step: "1" },
          { key: "FAST_SELL_GAS_LIMIT", label: "极速卖出 Gas", type: "number", min: "0", step: "10000" }
        ]
      },
      {
        title: "发现和补漏",
        fields: [
          { key: "EVENT_DISCOVERY", label: "发现方式", type: "select", options: ["ws", "chain", "rest"] },
          { key: "REST_DISCOVERY_ENABLED", label: "REST 补漏", type: "boolean" },
          { key: "REST_DISCOVERY_POLL_MS", label: "REST 补漏间隔 ms", type: "number", min: "1", step: "100" },
          { key: "WATCH_SCAN_LIMIT", label: "扫描数量", type: "number", min: "1", step: "1" }
        ]
      }
    ]
  }
];

const CONFIG_FIELDS = CONFIG_GROUPS.flatMap((group) =>
  group.sections.flatMap((section) => section.fields ?? [])
);

loadOverview();
scheduleOverviewTimer();
schedulePositionsTimer();
setInterval(updateCountdowns, 1000);

async function loadOverview({ force = false } = {}) {
  if (state.overviewLoading) {
    state.overviewPendingForce = state.overviewPendingForce || force;
    return;
  }
  state.overviewLoading = true;
  const generation = state.walletDataGeneration;
  if (force) els.refreshBtn.disabled = true;
  const startedAt = performance.now();
  try {
    const query = force ? "?force=1" : "";
    const data = await api(`/api/overview${query}`);
    if (generation !== state.walletDataGeneration) return;
    state.lastRefreshMs = Math.round(performance.now() - startedAt);
    state.data = data;
    render(data);
  } catch (error) {
    if (generation === state.walletDataGeneration) showToast(error.message || "刷新失败");
  } finally {
    state.overviewLoading = false;
    els.refreshBtn.disabled = false;
    if (state.overviewPendingForce) {
      state.overviewPendingForce = false;
      loadOverview({ force: true });
    }
  }
}

function scheduleOverviewTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    updateCountdowns();
    loadOverview();
  }, 5000);
}

function schedulePositionsTimer() {
  if (state.positionsTimer) clearInterval(state.positionsTimer);
  state.positionsTimer = setInterval(() => {
    if (state.positionsFastRefresh) loadPositions();
  }, 1000);
}

function setPositionsFastRefresh(enabled) {
  state.positionsFastRefresh = Boolean(enabled);
  els.positionFastRefresh?.classList.toggle("isActive", state.positionsFastRefresh);
  els.positionFastRefresh?.setAttribute("aria-pressed", state.positionsFastRefresh ? "true" : "false");
  if (state.positionsFastRefresh) loadPositions({ force: true });
}

async function loadPositions({ force = false } = {}) {
  if (state.positionsLoading) {
    state.positionsPendingForce = state.positionsPendingForce || force;
    return;
  }
  state.positionsLoading = true;
  const generation = state.walletDataGeneration;
  if (force && els.positionRefresh) els.positionRefresh.disabled = true;
  const startedAt = performance.now();
  try {
    const query = force ? "?force=1" : "";
    const data = await api(`/api/positions${query}`);
    if (generation !== state.walletDataGeneration) return;
    state.lastPositionsRefreshMs = Math.round(performance.now() - startedAt);
    applyPositionsSnapshot(data);
  } catch (error) {
    if (generation === state.walletDataGeneration) showToast(error.message || "持仓刷新失败");
  } finally {
    state.positionsLoading = false;
    if (els.positionRefresh) els.positionRefresh.disabled = false;
    if (state.positionsPendingForce) {
      state.positionsPendingForce = false;
      loadPositions({ force: true });
    }
  }
}

function applyPositionsSnapshot(data) {
  if (!state.data) return;
  const expectedWallet = state.data.settings?.config?.runtime?.walletAddress
    ?? state.data.dashboardWallet?.address
    ?? "";
  if (data?.wallet && expectedWallet && !sameWalletAddress(data.wallet, expectedWallet)) return;
  state.data.holdings = data.holdings;
  state.data.analytics = state.data.analytics ?? {};
  state.data.analytics.cards = {
    ...(state.data.analytics.cards ?? {}),
    ...(data.cards ?? {})
  };
  renderPositions(state.data);
  updatePositionRefreshText(data.updatedAt, data.elapsedMs);
}

function render(data) {
  const refreshText = state.lastRefreshMs === null ? "" : ` · ${state.lastRefreshMs}ms`;
  const modeText = "";
  els.updated.textContent = `更新 ${formatTime(data.updatedAt)}${refreshText}${modeText}`;
  els.botState.textContent = data.bot.label;
  els.botState.className = data.bot.tone;
  els.fundingState.textContent = data.wallet?.ready ? "够" : "不足";
  els.fundingState.className = data.wallet?.ready ? "good" : "warn";
  els.nextClock.dataset.startsAt = data.next.first?.startsAt ?? "";

  renderOverview(data);
  renderMarkets(data);
  renderPositions(data);
  renderBuySpeed(data.buySpeed);
  renderExecution(data.activity);
  renderStrategy(data);
  updatePositionRefreshText(data.updatedAt, null);
  updateCountdowns();
}

function renderOverview(data) {
  const failures = data.activity.filter((row) => row.label.includes("失败"));
  const skipped = data.activity.filter((row) => row.label === "已跳过");
  const attention = [];
  if (!data.bot.running) {
    attention.push({ tone: "warn", title: "Bot 未运行", detail: data.bot.message || "需要检查 launch agent 或手动启动。" });
  } else {
    attention.push({ tone: data.wallet?.ready ? "good" : "warn", title: data.bot.label, detail: data.bot.message || "运行状态正常。" });
  }
  if (!data.wallet?.ready) {
    attention.push({ tone: "warn", title: "资金未通过", detail: data.wallet?.message || "BUSDT 或 BNB 不足。" });
  }
  if (failures.length) {
    attention.push({ tone: "bad", title: `${failures.length} 条失败记录`, detail: failures[0].title });
  }
  if (!failures.length && data.wallet?.ready && data.bot.running) {
    attention.push({ tone: "good", title: "无需人工干预", detail: "当前运行、资金和最近执行记录没有阻断项。" });
  }

  els.attentionList.innerHTML = attention.map((item) => `
    <div class="attentionItem ${item.tone}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </div>
  `).join("");

  const cards = data.analytics.cards;
  els.overviewSnapshot.innerHTML = `
    ${summaryCard("持仓价值", `${cards.openValue} U`, cards.openPnl, cards.openPositive)}
    ${summaryCard("总盈亏", `${cards.totalPnl} U`, cards.totalRoi, cards.totalPositive)}
    ${summaryCard("投入", `${cards.openCost} U`, "当前持仓成本", true)}
    ${summaryCard("可卖仓位", `${data.holdings.count} 个`, "Bot wallet", true)}
  `;

  const next = data.next.first;
  els.overviewNextAction.innerHTML = next ? `
    <div class="nextAction">
      <strong title="${escapeAttr(next.title)}">${escapeHtml(next.title)}</strong>
      <span>${escapeHtml(marketScheduleText(next))}</span>
      <span>outcome ${formatOutcomeCount(next)} 个 · 买 ${next.choices} 档 · ${next.stake} U</span>
      <span class="tag" data-countdown="${escapeAttr(next.startsAt)}">--</span>
    </div>
  ` : `<div class="empty">暂无待开盘市场</div>`;

  const reviewRows = [...failures, ...skipped].slice(0, 4);
  els.overviewActivityMini.innerHTML = reviewRows.length ? reviewRows.map(renderCompactActivity).join("") : `<div class="empty">最近没有失败或跳过项</div>`;
}

function renderMarkets(data) {
  renderNext(data.next);
  renderNewMarkets(data.newMarkets);
}

function renderNewMarkets(feed) {
  const matchedItems = feed.items
    .filter((item) => marketMatchesFilter(item, state.marketFilter))
    .sort(compareMarketsByOpenTime);
  const items = state.marketFilter === "all" ? matchedItems.slice(0, 120) : matchedItems;
  const baseCount = feed.excluded ? `${feed.count} 个 · 刷掉 ${feed.excluded}` : `${feed.count} 个`;
  els.newMarketCount.textContent = state.marketFilter === "all"
    ? `${baseCount}${matchedItems.length > items.length ? ` · 展示 ${items.length}` : ""}`
    : `${items.length} / ${feed.count}`;
  if (!items.length) {
    els.newMarketList.innerHTML = `<div class="empty">暂无匹配市场</div>`;
    return;
  }
  els.newMarketList.innerHTML = `
    <div class="tableHeader marketRow">
      <span>Market</span>
      <span>时间 UTC+8</span>
      <span>Outcome</span>
      <span>State</span>
      <span>Stake</span>
    </div>
    ${items.map(renderMarketRow).join("")}
  `;
  for (const button of document.querySelectorAll("[data-market-diagnose]")) {
    button.addEventListener("click", () => diagnoseMarket(button.dataset.marketDiagnose));
  }
  bindOperatorApprovalButtons();
  for (const button of document.querySelectorAll("[data-market-exclude-action]")) {
    button.addEventListener("click", () => updateMarketExclusion(button.dataset.market, button.dataset.marketExcludeAction));
  }
  bindOutcomeSelectionControls();
}

function renderMarketRow(item) {
  const key = marketKey(item.market);
  const expanded = key && state.outcomeSelectorMarket === key;
  const manualCount = item.manualOutcomeSelection?.tokenIds?.length ?? 0;
  return `
    <div class="marketRow ${manualCount > 0 ? "hasManualOutcomes" : ""}">
      <div class="marketQuestion">
        <div class="marketQuestionTop">
          <strong title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</strong>
          ${renderOutcomeSelectionButton(item)}
          ${renderOperatorApprovalButton(item)}
          ${renderMarketDiagnoseButton(item)}
          ${renderMarketExclusionButton(item)}
        </div>
        <small>${escapeHtml(item.meta ?? marketInlineMeta(item))}</small>
        ${renderMarketDiagnostics(item)}
      </div>
      <div class="marketTimes">${marketScheduleHtml(item)}</div>
      <div class="outcomeCountCell">
        <strong>${formatOutcomeCount(item)}</strong><small>个</small>
        ${manualCount > 0 ? `<em>手选 ${manualCount}</em>` : ""}
      </div>
      <div><span class="marketState ${marketStateTone(item.tone)}">${escapeHtml(item.state)}</span></div>
      <div>${item.stake} U</div>
    </div>
    ${expanded ? renderOutcomeSelectionPanel(item) : ""}
  `;
}

function renderOutcomeSelectionButton(item) {
  if (!item.market || !Array.isArray(item.outcomes) || item.outcomes.length === 0) return "";
  const key = marketKey(item.market);
  const active = Boolean(item.manualOutcomeSelection?.active);
  const expanded = key && state.outcomeSelectorMarket === key;
  const label = active ? "已手选 outcome" : "选择买入 outcome";
  return `
    <button class="ghost iconButton miniIconButton outcomeSelectBtn ${active ? "isActive" : ""} ${expanded ? "isExpanded" : ""}" type="button" title="${label}" aria-label="${label}" data-outcome-select="${escapeAttr(item.market)}">
      ${icon("sliders-horizontal")}
    </button>
  `;
}

function renderOutcomeSelectionPanel(item) {
  const key = marketKey(item.market);
  const outcomes = item.outcomes ?? [];
  const draft = outcomeDraftFor(item);
  const selected = new Set(draft);
  const saving = Boolean(state.outcomeSaving[key]);
  return `
    <div class="outcomeSelectorRow" data-outcome-panel="${escapeAttr(item.market)}">
      <div class="outcomeSelectorHead">
        <div>
          <strong>手动选择买入 outcome</strong>
          <span>${selected.size ? `已选 ${selected.size} 个；保存后覆盖默认选择策略` : "未选择时使用默认选择策略"}</span>
        </div>
        <div class="outcomeSelectorActions">
          <button class="ghost iconButton" type="button" data-outcome-clear="${escapeAttr(item.market)}" ${saving || selected.size === 0 ? "disabled" : ""}>
            <span>${saving ? "处理中" : "清空"}</span>
          </button>
          <button class="iconButton" type="button" data-outcome-save="${escapeAttr(item.market)}" ${saving ? "disabled" : ""}>
            ${icon(saving ? "loader-circle" : "save")}
            <span>${saving ? "保存中" : "保存选择"}</span>
          </button>
        </div>
      </div>
      <div class="outcomeChoiceGrid">
        ${outcomes.map((outcome) => renderOutcomeChoice(item, outcome, selected)).join("")}
      </div>
    </div>
  `;
}

function renderOutcomeChoice(item, outcome, selected) {
  const tokenId = String(outcome.tokenId ?? "");
  const active = selected.has(tokenId);
  const detail = [
    outcome.payout !== null && outcome.payout !== undefined ? `payout ${formatOutcomeMetric(outcome.payout)}` : "",
    outcome.price !== null && outcome.price !== undefined ? `price ${formatOutcomeMetric(outcome.price)}` : ""
  ].filter(Boolean).join(" · ");
  return `
    <button class="outcomeChoice ${active ? "isSelected" : ""}" type="button" data-outcome-toggle="${escapeAttr(item.market)}" data-token-id="${escapeAttr(tokenId)}">
      <strong>${escapeHtml(outcome.name ?? tokenId)}</strong>
      <small>${escapeHtml(detail || `token ${shortTokenId(tokenId)}`)}</small>
    </button>
  `;
}

function bindOutcomeSelectionControls() {
  for (const button of document.querySelectorAll("[data-outcome-select]")) {
    button.addEventListener("click", () => toggleOutcomeSelector(button.dataset.outcomeSelect));
  }
  for (const button of document.querySelectorAll("[data-outcome-toggle]")) {
    button.addEventListener("click", () => toggleOutcomeDraftToken(button.dataset.outcomeToggle, button.dataset.tokenId));
  }
  for (const button of document.querySelectorAll("[data-outcome-save]")) {
    button.addEventListener("click", () => saveOutcomeSelection(button.dataset.outcomeSave));
  }
  for (const button of document.querySelectorAll("[data-outcome-clear]")) {
    button.addEventListener("click", () => saveOutcomeSelection(button.dataset.outcomeClear, []));
  }
}

function toggleOutcomeSelector(market) {
  const key = marketKey(market);
  if (!key) return;
  const item = findMarketFeedItem(market);
  if (item) outcomeDraftFor(item);
  state.outcomeSelectorMarket = state.outcomeSelectorMarket === key ? null : key;
  if (state.data) renderNewMarkets(state.data.newMarkets);
}

function toggleOutcomeDraftToken(market, tokenId) {
  const key = marketKey(market);
  if (!key || !tokenId) return;
  const item = findMarketFeedItem(market);
  const current = new Set(item ? outcomeDraftFor(item) : state.outcomeDrafts[key] ?? []);
  if (current.has(tokenId)) current.delete(tokenId);
  else current.add(tokenId);
  state.outcomeDrafts[key] = [...current];
  if (state.data) renderNewMarkets(state.data.newMarkets);
}

function outcomeDraftFor(item) {
  const key = marketKey(item?.market);
  if (!key) return [];
  if (!Array.isArray(state.outcomeDrafts[key])) {
    state.outcomeDrafts[key] = [...(item?.manualOutcomeSelection?.tokenIds ?? [])].map(String);
  }
  return state.outcomeDrafts[key];
}

async function saveOutcomeSelection(market, forcedTokenIds = null) {
  const key = marketKey(market);
  if (!key) return;
  const tokenIds = Array.isArray(forcedTokenIds) ? forcedTokenIds : [...(state.outcomeDrafts[key] ?? [])];
  state.outcomeSaving[key] = true;
  if (state.data) renderNewMarkets(state.data.newMarkets);
  try {
    await api("/api/market/outcomes", {
      method: "POST",
      body: JSON.stringify({ market, tokenIds })
    });
    delete state.outcomeDrafts[key];
    setRestartStatus(tokenIds.length ? "已保存手动 outcome 选择，重启 Watch 后生效" : "已清空手动 outcome 选择，重启 Watch 后恢复默认", "warn");
    showToast(tokenIds.length ? `已保存 ${tokenIds.length} 个手选 outcome` : "已清空手选 outcome，恢复默认逻辑");
    await loadOverview({ force: true });
  } catch (error) {
    showToast(error.message || "保存 outcome 选择失败");
  } finally {
    state.outcomeSaving[key] = false;
    if (state.data) renderNewMarkets(state.data.newMarkets);
  }
}

function findMarketFeedItem(market) {
  const key = marketKey(market);
  return state.data?.newMarkets?.items?.find((item) => marketKey(item.market) === key) ?? null;
}

function formatOutcomeMetric(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  if (number >= 1000) return number.toFixed(0);
  if (number >= 10) return number.toFixed(2).replace(/\.?0+$/u, "");
  return number.toFixed(4).replace(/\.?0+$/u, "");
}

function shortTokenId(value) {
  const text = String(value ?? "");
  if (text.length <= 10) return text || "--";
  return `${text.slice(0, 5)}...${text.slice(-4)}`;
}

function renderOperatorApprovalButton(item) {
  if (!item.market) return "";
  const key = marketKey(item.market);
  const transient = state.operatorApprovals[key] ?? {};
  const serverState = item.operatorApproval ?? {};
  const stateItem = transient.loading || transient.pending || transient.error || transient.approved
    ? transient
    : serverState;
  const loading = Boolean(stateItem.loading);
  const approved = Boolean(stateItem.approved);
  const pending = Boolean(stateItem.pending || stateItem.status === "pending");
  const failed = Boolean(stateItem.failed || stateItem.error || stateItem.status === "failed");
  const statusText = approved
    ? "已授权"
    : pending || loading
      ? "授权中"
      : failed
        ? "授权失败"
        : stateItem.status === "unknown"
          ? "状态未知"
          : "未授权";
  const label = stateItem.error
    ? `${statusText}：${stateItem.error}`
    : approved
      ? "卖出授权已完成"
      : pending
        ? "卖出授权已广播"
        : loading
          ? "卖出授权中"
          : "点击提前授权卖出";
  const visibleStatus = Boolean(item.showStatus);
  return `
    <button class="ghost iconButton ${visibleStatus ? "operatorStatusButton" : "miniIconButton"} operatorApprovalBtn ${approved ? "isApproved" : ""} ${failed ? "isFailed" : ""}" type="button" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" data-operator-approve="${escapeAttr(item.market)}" data-title="${escapeAttr(item.title ?? "")}" ${loading || pending || approved ? "disabled" : ""}>
      ${visibleStatus
        ? `<span class="operatorStatusDot ${approved ? "isApproved" : pending || loading ? "isPending" : failed ? "isFailed" : "isUnapproved"}"></span><span>${statusText}</span>`
        : icon(loading ? "loader-circle" : "key-round")}
    </button>
  `;
}

function renderMarketDiagnoseButton(item) {
  if (!item.market) return "";
  const key = marketKey(item.market);
  const diagnostics = state.marketDiagnostics[key] ?? {};
  const loading = Boolean(diagnostics.loading);
  const label = loading ? "诊断中" : "诊断市场";
  return `
    <button class="ghost iconButton miniIconButton marketDiagnoseBtn" type="button" title="${label}" aria-label="${label}" data-market-diagnose="${escapeAttr(item.market)}" ${loading ? "disabled" : ""}>
      ${icon(loading ? "loader-circle" : "shield-check")}
    </button>
  `;
}

function renderMarketExclusionButton(item) {
  if (!item.market) return "";
  const excluded = Boolean(item.manuallyExcluded);
  const action = excluded ? "restore" : "exclude";
  const label = excluded ? "恢复这个市场" : "去除这个市场";
  return `
    <button class="ghost iconButton miniIconButton ${excluded ? "isActive" : ""}" type="button" title="${label}" aria-label="${label}" data-market="${escapeAttr(item.market)}" data-market-exclude-action="${action}">
      ${icon(excluded ? "refresh-cw" : "x")}
    </button>
  `;
}

function renderMarketDiagnostics(item) {
  if (!item.market) return "";
  const key = marketKey(item.market);
  const override = state.marketDiagnostics[key];
  const diagnostics = override ?? item.diagnostics ?? {};
  const badges = diagnostics.badges ?? [];
  const loading = Boolean(diagnostics.loading);
  const error = diagnostics.error ?? "";
  const checkedAt = diagnostics.checkedAt ? ` · ${formatTime(diagnostics.checkedAt)}` : "";
  if (!badges.length && !loading && !error && !diagnostics.checkedAt) return "";
  return `
    <div class="marketEvidence">
      ${badges.map(renderMarketEvidenceBadge).join("")}
      ${loading ? `<span class="evidenceTag evidenceNeutral">诊断中</span>` : ""}
      ${error ? `<span class="evidenceTag evidenceBad" title="${escapeAttr(error)}">诊断失败</span>` : ""}
    </div>
    ${diagnostics.checkedAt ? `<div class="marketEvidenceMeta">诊断 ${escapeHtml(checkedAt.replace(/^ · /, ""))}</div>` : ""}
  `;
}

function renderMarketEvidenceBadge(badge) {
  return `<span class="evidenceTag ${marketEvidenceTone(badge.tone)}" title="${escapeAttr(badge.detail ?? "")}">${escapeHtml(badge.label)}${badge.detail ? `<small>${escapeHtml(badge.detail)}</small>` : ""}</span>`;
}

function marketEvidenceTone(tone) {
  if (tone === "good") return "evidenceGood";
  if (tone === "warn") return "evidenceWarn";
  if (tone === "bad") return "evidenceBad";
  return "evidenceNeutral";
}

function bindOperatorApprovalButtons() {
  for (const button of document.querySelectorAll("[data-operator-approve]")) {
    if (button.dataset.operatorBound === "1") continue;
    button.dataset.operatorBound = "1";
    button.addEventListener("click", () => approveOperatorForMarket(button.dataset.operatorApprove, button.dataset.title));
  }
}

async function approveOperatorForMarket(market, title = "") {
  const key = marketKey(market);
  if (!key) return;
  const current = state.operatorApprovals[key] ?? {};
  if (current.loading || current.approved) return;
  const name = title || shortAddress(market);
  const confirmed = window.confirm(`这会提交真实链上交易：给该市场开启卖出 operator 授权。它不按数量限制，会覆盖这个市场的全部 outcome 卖出权限，并消耗少量 BNB gas。继续授权「${name}」？`);
  if (!confirmed) return;
  state.operatorApprovals[key] = { ...current, loading: true, error: "" };
  rerenderMarketViews();
  try {
    const data = await api("/api/operator/approve", {
      method: "POST",
      body: JSON.stringify({ market, title })
    });
    let approval = data.operatorApproval ?? {};
    if (approval.taskId) {
      approval = await waitForOperatorApprovalTask(approval.taskId, key);
    }
    const approved = Boolean(approval.approved || approval.operatorApproved || approval.alreadyApproved);
    const pending = approval.status === "broadcast" && !approved;
    const statusText = approval.statusText || (approved ? "已授权" : "已广播");
    state.operatorApprovals[key] = {
      loading: false,
      approved,
      pending,
      statusText,
      txHash: approval.txHash || ""
    };
    showToast(approval.txHash ? `${statusText} · ${shortAddress(approval.txHash)}` : statusText);
    await loadOverview({ force: true });
  } catch (error) {
    state.operatorApprovals[key] = {
      loading: false,
      approved: false,
      error: error.message || "卖出授权失败"
    };
    showToast(error.message || "卖出授权失败");
  } finally {
    rerenderMarketViews();
  }
}

function rerenderMarketViews() {
  if (!state.data) return;
  renderMarkets(state.data);
  renderHoldings(state.data.holdings);
}

async function diagnoseMarket(market) {
  const key = marketKey(market);
  if (!key) return;
  state.marketDiagnostics[key] = {
    ...(state.marketDiagnostics[key] ?? {}),
    loading: true,
    error: ""
  };
  if (state.data) renderNewMarkets(state.data.newMarkets);
  try {
    const data = await api("/api/market/diagnostics", {
      method: "POST",
      body: JSON.stringify({ market })
    });
    state.marketDiagnostics[key] = {
      ...data,
      loading: false,
      error: ""
    };
  } catch (error) {
    state.marketDiagnostics[key] = {
      ...(state.marketDiagnostics[key] ?? {}),
      loading: false,
      error: error.message || "诊断失败"
    };
    toast(error.message || "诊断失败", true);
  }
  if (state.data) renderNewMarkets(state.data.newMarkets);
}

async function updateMarketExclusion(market, action) {
  if (!market) return;
  const isRestore = action === "restore";
  const message = isRestore ? "恢复这个市场进入候选？" : "把这个市场加入手动去除名单？";
  if (!window.confirm(message)) return;
  try {
    const data = await api("/api/market/exclusion", {
      method: "POST",
      body: JSON.stringify({ market, action })
    });
    state.configDirty = false;
    renderConfig(data.config, state.data?.settings?.runtimeStatus, { force: true });
    setRestartStatus(isRestore ? "已恢复市场，重启 Watch 后生效" : "已去除市场，重启 Watch 后生效", "warn");
    showToast(isRestore ? "已从手动去除名单移除" : "已加入手动去除名单");
    await loadOverview({ force: true });
    if (window.confirm("立即重启 Watch 让手动去除名单生效？")) {
      await restartWatch({ confirm: false });
    }
  } catch (error) {
    showToast(error.message || "更新去除名单失败");
  }
}

function renderNext(next) {
  els.nextCount.textContent = `${next.count} 场`;
  if (!next.items.length) {
    els.upcomingList.innerHTML = `<div class="empty">暂无</div>`;
    return;
  }
  els.upcomingList.innerHTML = next.items.map((item) => `
    <div class="compactRow">
      <div class="compactTop">
        <strong title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</strong>
        ${renderOperatorApprovalButton(item)}
      </div>
      <span>${escapeHtml(marketScheduleText(item))}</span>
      <span>${escapeHtml(marketInlineMeta(item))} · ${item.stake} U</span>
      <span class="tag" data-countdown="${escapeAttr(item.startsAt)}">--</span>
    </div>
  `).join("");
  bindOperatorApprovalButtons();
}

function formatOutcomeCount(item) {
  const count = Number(item?.outcomeCount ?? item?.availableOutcomeCount ?? item?.choices ?? 0);
  return Number.isFinite(count) ? String(count) : "0";
}

function marketInlineMeta(item) {
  return [
    item?.category || "Event Market",
    `outcome ${formatOutcomeCount(item)} 个`,
    `买 ${item?.choices ?? "--"} 档`
  ].filter(Boolean).join(" · ");
}

function marketScheduleText(item) {
  const premium = marketPremiumWindowLabel(item);
  return `开 ${formatDate(item.startsAt)} · 闭 ${formatDate(item.endsAt)} · 持续 ${marketDurationLabel(item)}${premium ? ` · ${premium}` : ""} · UTC+8`;
}

function marketScheduleHtml(item) {
  const premium = marketPremiumWindowLabel(item);
  return `
    <span>开 ${formatDate(item.startsAt)}</span>
    <span>闭 ${formatDate(item.endsAt)}</span>
    <small>持续 ${escapeHtml(marketDurationLabel(item))}${premium ? ` · ${escapeHtml(premium)}` : ""} · UTC+8</small>
  `;
}

function marketPremiumWindowLabel(item) {
  const premium = item?.premiumWindow;
  if (premium?.label) return `溢价窗 ${premium.label}`;
  const value = Number(premium?.seconds);
  if (!Number.isFinite(value) || value < 0) return "";
  return `溢价窗 ${formatSeconds(value)}`;
}

function formatSeconds(value) {
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded).replace(/0+$/u, "").replace(/\.$/u, "")}s`;
}

function renderPositions(data) {
  const cards = data.analytics.cards;
  els.positionSummary.innerHTML = `
    ${summaryCard("投入", `${cards.openCost} U`, "当前持仓成本", true)}
    ${summaryCard("当前", `${cards.openValue} U`, `${cards.openPnl} U`, cards.openPositive)}
    ${summaryCard("总盈亏", `${cards.totalPnl} U`, cards.totalRoi, cards.totalPositive)}
    ${summaryCard("可卖仓位", `${data.holdings.count} 个`, "按 outcome 卖出", true)}
  `;
  renderHoldings(data.holdings);
  renderProjectStats(data.analytics.projects);
}

function updatePositionRefreshText(updatedAt, serverElapsedMs = null) {
  if (!els.positionUpdated) return;
  const clientMs = state.lastPositionsRefreshMs === null ? "" : ` · ${state.lastPositionsRefreshMs}ms`;
  const serverMs = serverElapsedMs === null || serverElapsedMs === undefined ? "" : ` · 接口${serverElapsedMs}ms`;
  const mode = state.positionsFastRefresh ? " · 收益1s" : "";
  els.positionUpdated.textContent = `持仓 ${formatTime(updatedAt)}${clientMs}${serverMs}${mode}`;
}

function renderHoldings(holdings) {
  els.holdingCount.textContent = `${holdings.count} 个`;
  if (!holdings.groups.length) {
    els.holdingsList.innerHTML = `<div class="empty">暂无</div>`;
    return;
  }
  els.holdingsList.innerHTML = holdings.groups.map((group) => `
    <section class="marketGroup">
      <div class="marketTop">
        <div>
          <div class="marketTitle" title="${escapeAttr(group.title)}">${escapeHtml(group.title)}</div>
          <div class="marketMeta">投入 ${group.cost} U · 当前 ${group.value} U · ${group.positionCount} 仓</div>
        </div>
        <div class="marketActions">
          <strong class="${group.positive ? "good" : "bad"}">${group.pnl} U</strong>
          ${renderOperatorApprovalButton({
            market: group.market,
            title: group.title,
            operatorApproval: group.operatorApproval,
            showStatus: true
          })}
          <button class="ghost iconButton marketSellBtn" data-sell='${escapeAttr(JSON.stringify(marketSellPayload(group)))}' ${group.sellable ? "" : "disabled"}>
            ${icon("badge-dollar-sign")}<span>卖本市场</span>
          </button>
        </div>
      </div>
      <div class="positionTable">
        ${group.items.map(renderPosition).join("")}
      </div>
    </section>
  `).join("");

  for (const button of document.querySelectorAll("[data-sell]")) {
    button.addEventListener("click", () => openSell(JSON.parse(button.dataset.sell)));
  }
  bindOperatorApprovalButtons();
}

function marketSellPayload(group) {
  return {
    market: group.market,
    all: true,
    title: group.title,
    outcome: `全部 ${group.positionCount} 个仓位`,
    value: group.value,
    pnl: group.pnl,
    pnlPct: group.pnlPct,
    positive: group.positive,
    sellable: group.sellable,
    positionCount: group.positionCount
  };
}

function renderPosition(item) {
  return `
    <div class="positionRow">
      <div class="positionName">${escapeHtml(item.outcome)}</div>
      <div class="stat"><span>买入价</span><strong>${item.buyPrice}</strong></div>
      <div class="stat"><span>当前价</span><strong>${item.nowPrice}</strong></div>
      <div class="stat"><span>投入</span><strong>${item.cost} U</strong></div>
      <div class="stat"><span>当前</span><strong>${item.value} U</strong></div>
      <div class="stat"><span>盈亏</span><strong class="${item.positive ? "good" : "bad"}">${item.pnl} U</strong></div>
      <div class="stat"><span>收益</span><strong class="${item.positive ? "good" : "bad"}">${item.pnlPct}</strong></div>
      <button class="sellBtn iconButton" data-sell='${escapeAttr(JSON.stringify(item))}' ${item.sellable ? "" : "disabled"}>${icon("badge-dollar-sign")}<span>卖出</span></button>
    </div>
  `;
}

function renderProjectStats(projects) {
  els.projectCount.textContent = `${projects.length} 个`;
  if (!projects.length) {
    els.projectStats.innerHTML = `<div class="empty">暂无</div>`;
    return;
  }
  els.projectStats.innerHTML = projects.map((project) => `
    <div class="projectRow">
      <div class="projectTitle" title="${escapeAttr(project.title)}">${escapeHtml(project.title)}</div>
      <div class="projectNums">
        <div class="stat"><span>买入</span><strong>${project.bought} U</strong></div>
        <div class="stat"><span>当前</span><strong>${project.openValue} U</strong></div>
        <div class="stat"><span>已收回</span><strong>${project.sold} U</strong></div>
        <div class="stat"><span>盈亏</span><strong class="${project.positive ? "good" : "bad"}">${project.pnl} U</strong></div>
        <div class="stat"><span>收益</span><strong class="${project.positive ? "good" : "bad"}">${project.roi}</strong></div>
      </div>
    </div>
  `).join("");
}

function renderBuySpeed(speed) {
  if (!els.buySpeedList) return;
  const items = speed?.items ?? [];
  if (!items.length) {
    els.buySpeedList.innerHTML = `<div class="empty">暂无买入速度统计</div>`;
    return;
  }
  els.buySpeedList.innerHTML = items.map((item) => `
    <div class="speedRow">
      <div class="speedMain">
        <strong title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</strong>
        <span>${formatTime(item.at)} · ${escapeHtml(item.stake || "--")} · ${escapeHtml(String(item.outcomes ?? "--"))} 档</span>
      </div>
      <div class="speedStats">
        <div class="stat"><span>排名</span><strong>${item.rank ? `第 ${item.rank}` : "--"}</strong></div>
        <div class="stat"><span>Block</span><strong>${item.blockNumber ?? "--"}</strong></div>
        <div class="stat"><span>TxIndex</span><strong>${item.txIndex ?? "--"}</strong></div>
        <div class="stat"><span>Gas</span><strong>${escapeHtml(item.gasGwei || "--")}</strong></div>
        <div class="stat"><span>开盘偏差</span><strong>${item.openDeltaSec === null || item.openDeltaSec === undefined ? "--" : `${item.openDeltaSec}s`}</strong></div>
      </div>
      ${item.peers?.length ? renderSpeedPeers(item.peers) : `<div class="speedError">${escapeHtml(item.message || "未确认买入排名")}</div>`}
    </div>
  `).join("");
}

function renderSpeedPeers(peers = []) {
  if (!peers.length) return `<div class="speedPeers emptyInline">无前排数据</div>`;
  return `
    <div class="speedPeers">
      ${peers.map((peer) => `
        <span>#${peer.rank} ${escapeHtml(peer.gasGwei || "--")} · ${peer.blockNumber}/${peer.txIndex}</span>
      `).join("")}
    </div>
  `;
}

function renderExecution(rows) {
  if (!rows.length) {
    els.activityList.innerHTML = `<div class="empty">暂无</div>`;
    return;
  }
  els.activityList.innerHTML = rows.map(renderActivityRow).join("");
}

function renderActivityRow(row) {
  const title = splitActivityTitle(row.title);
  return `
    <div class="activityRow">
      <div class="activityBody">
        <div class="activityTitle" title="${escapeAttr(row.title)}">${escapeHtml(title.main)}</div>
        ${title.detail ? `<div class="activityOutcome">${escapeHtml(title.detail)}</div>` : ""}
        <div class="activityMeta">
          <span>${icon("clock", "metaIcon")}${formatTime(row.time)}</span>
          ${row.amount ? `<span>${escapeHtml(row.amount)}</span>` : ""}
        </div>
      </div>
      <span class="activityType ${activityTone(row.label)}">${escapeHtml(row.label)}</span>
    </div>
  `;
}

function renderCompactActivity(row) {
  return `
    <div class="compactRow">
      <strong title="${escapeAttr(row.title)}">${escapeHtml(splitActivityTitle(row.title).main)}</strong>
      <span>${formatTime(row.time)} · ${escapeHtml(row.label)}</span>
    </div>
  `;
}

function renderStrategy(data) {
  els.stakeText.textContent = data.settings?.stakeText ?? "--";
  els.windowText.textContent = data.settings?.windowText ?? "--";
  els.autoSellText.textContent = data.settings?.autoSellText ?? "--";
  renderConfig(data.settings?.config, data.settings?.runtimeStatus);
  renderApprovalDefaults(data);
  const checks = [
    {
      label: "当前钱包",
      value: data.dashboardWallet?.address ? `${shortAddress(data.dashboardWallet.address)} / ${data.dashboardWallet.source ?? "--"}` : "--",
      tone: data.dashboardWallet?.matchesPrivateKey === false ? "warn" : "good"
    },
    { label: "运行状态", value: data.bot.label, tone: data.bot.tone },
    { label: "BUSDT / BNB", value: data.wallet ? `${data.wallet.busdt} U / ${data.wallet.bnb} BNB` : "--", tone: data.wallet?.ready ? "good" : "warn" },
    { label: "Router 授权", value: data.wallet ? `${data.wallet.allowance} / ${data.wallet.minimumRequired} U` : "--", tone: data.wallet?.allowanceReady ? "good" : "warn" },
    { label: "完整批次", value: data.wallet ? `${data.wallet.busdt} / ${data.wallet.fullBatchRequired} U` : "--", tone: data.wallet?.fullBatchReady ? "good" : "warn" },
    { label: "下一批市场", value: `${data.next.count} 场`, tone: data.next.count ? "warn" : "neutral" },
    { label: "持仓数量", value: `${data.holdings.count} 个`, tone: data.holdings.count ? "good" : "neutral" }
  ];
  els.preflightList.innerHTML = checks.map((check) => `
    <div class="preflightRow">
      <span>${escapeHtml(check.label)}</span>
      <strong class="${check.tone}">${escapeHtml(check.value)}</strong>
    </div>
  `).join("");
}

function renderConfig(config, runtimeStatus = null, { force = false } = {}) {
  if (!els.configForm || !config) return;
  if (state.configRendered && !force) {
    updateRenderedWatchRuntime(runtimeStatus);
    return;
  }
  if (state.configDirty && els.configForm.contains(document.activeElement)) return;
  const values = config.values ?? {};
  const runtime = config.runtime ?? {};
  const walletMatchText = runtime.privateKeyLoaded
    ? (runtime.walletMatchesPrivateKey ? "私钥匹配" : "私钥不匹配")
    : "私钥未加载";
  const selectedGroup = CONFIG_GROUPS.some((group) => group.id === state.configGroup)
    ? state.configGroup
    : CONFIG_GROUPS[0].id;
  state.configGroup = selectedGroup;
  els.configFileText.textContent = `${config.file ?? ".env.local"} · ${runtime.dryRun ? "dry-run" : "execute"}`;
  els.configForm.innerHTML = `
    ${renderWatchRuntime(runtimeStatus)}
    ${renderWalletProfileSelector(config.walletProfiles)}
    <div class="configRuntime">
      <span>钱包 ${runtime.walletAddress ? shortAddress(runtime.walletAddress) : "--"}</span>
      <span>${walletMatchText}</span>
      <span>RPC ${runtime.rpcConfigured && runtime.wsConfigured ? "已配置" : "缺失"}</span>
    </div>
    ${renderConfigTabs(selectedGroup)}
    <div class="configGroups">
      ${CONFIG_GROUPS.map((group) => renderConfigGroup(group, values, selectedGroup)).join("")}
    </div>
  `;
  if (config.walletProfiles?.available) {
    const walletAddressInput = els.configForm.querySelector('[data-config-key="WALLET_ADDRESS"]');
    if (walletAddressInput) {
      walletAddressInput.disabled = true;
      walletAddressInput.title = "请使用钱包切换器同时切换地址和私钥";
    }
  }
  state.configRendered = true;
}

function renderWalletProfileSelector(walletProfiles) {
  if (!walletProfiles?.available || !walletProfiles.profiles?.length) return "";
  const activeId = walletProfiles.activeId ?? "";
  return `
    <section class="walletProfileBar">
      <div class="walletProfileCopy">
        <strong>${icon("key-round")} 钱包</strong>
        <span>切换时同步私钥、地址和持仓数据</span>
      </div>
      <div class="walletProfileControls">
        <select data-wallet-profile-select aria-label="选择钱包">
          ${walletProfiles.profiles.map((profile) => `
            <option value="${escapeAttr(profile.id)}" ${profile.id === activeId ? "selected" : ""}>
              ${escapeHtml(profile.label)} · ${escapeHtml(shortAddress(profile.address))}
            </option>
          `).join("")}
        </select>
        <button class="ghost iconButton" type="button" data-wallet-profile-activate disabled>
          ${icon("refresh-cw")}<span>切换并重启</span>
        </button>
      </div>
    </section>
  `;
}

function updateRenderedWatchRuntime(runtimeStatus) {
  const current = els.configForm?.querySelector(".watchRuntime");
  if (current) current.outerHTML = renderWatchRuntime(runtimeStatus);
}

function renderConfigTabs(selectedGroup) {
  return `
    <div class="configTabs" role="tablist" aria-label="配置分组">
      ${CONFIG_GROUPS.map((group) => `
        <button class="${group.id === selectedGroup ? "isActive" : ""}" type="button" role="tab" aria-selected="${group.id === selectedGroup ? "true" : "false"}" data-config-group="${escapeAttr(group.id)}">
          ${escapeHtml(group.label)}
        </button>
      `).join("")}
    </div>
  `;
}

function renderConfigGroup(group, values, selectedGroup) {
  return `
    <section class="configGroup ${group.id === selectedGroup ? "isActive" : ""}" data-config-panel="${escapeAttr(group.id)}" role="tabpanel">
      <div class="configGroupHead">
        <h4>${escapeHtml(group.label)}</h4>
        <span>${escapeHtml(group.description)}</span>
      </div>
      ${group.sections.map((section) => renderConfigSection(section, values)).join("")}
    </section>
  `;
}

function renderConfigSection(section, values) {
  if (section.custom === "buyEntryMode") return renderBuyEntryModeSection(section, values);

  const content = `
    <div class="configSectionGrid ${section.fields.length <= 2 ? "compact" : ""}">
      ${section.fields.map((field) => renderConfigField(field, values[field.key])).join("")}
    </div>
  `;
  if (section.collapsible) {
    return `
      <details class="configSection configSectionAdvanced">
        <summary>${escapeHtml(section.title)}</summary>
        ${content}
      </details>
    `;
  }
  return `
    <section class="configSection">
      <div class="configSectionHead">
        <h5>${escapeHtml(section.title)}</h5>
      </div>
      ${content}
    </section>
  `;
}

function renderBuyEntryModeSection(section, values) {
  const activeMode = detectBuyEntryMode(values);
  return `
    <section class="configSection">
      <div class="configSectionHead">
        <h5>${escapeHtml(section.title)}</h5>
      </div>
      <div class="buyEntryModes" data-buy-entry-current="${escapeAttr(activeMode)}">
        ${BUY_ENTRY_MODES.map((mode) => renderBuyEntryModeCard(mode, activeMode)).join("")}
      </div>
    </section>
  `;
}

function renderBuyEntryModeCard(mode, activeMode) {
  const active = activeMode === mode.id;
  return `
    <button class="buyEntryMode ${mode.tone ?? ""} ${active ? "isActive" : ""}" type="button" data-buy-entry-mode="${escapeAttr(mode.id)}">
      <span class="buyEntryModeTop">
        <strong>${escapeHtml(mode.label)}</strong>
        <span>${active ? "当前" : "套用"}</span>
      </span>
      <small>${escapeHtml(mode.description)}</small>
      <span class="buyEntryModeParams">
        ${mode.params.map((item) => `<em>${escapeHtml(item)}</em>`).join("")}
      </span>
    </button>
  `;
}

function detectBuyEntryMode(values) {
  const delay = Number(values.EVENT_BUY_DELAY_SECONDS ?? 0);
  const restStatus = String(values.REQUIRE_REST_STATUS ?? "").trim().toLowerCase();
  const requireRest = truthy(values.REQUIRE_REST_BEFORE_BUY);
  const requireQuote = truthy(values.REQUIRE_QUOTE_BEFORE_BUY);
  const requireChainMint = truthy(values.REQUIRE_CHAIN_MINT_BEFORE_BUY);
  const allowOnchainOnly = truthy(values.ALLOW_ONCHAIN_ONLY_MARKETS);
  const fallback = String(values.EVENT_OUTCOME_SELECTION_FALLBACK ?? "").trim();

  if (
    delay === 0 &&
    !requireRest &&
    !restStatus &&
    !requireQuote &&
    !requireChainMint &&
    allowOnchainOnly &&
    fallback === "token_order"
  ) {
    return "instant";
  }

  if (
    delay > 0 &&
    (requireRest || restStatus.split(",").map((item) => item.trim()).includes("live")) &&
    !allowOnchainOnly &&
    fallback === "error"
  ) {
    return "anti";
  }

  return "custom";
}

function renderWatchRuntime(runtime) {
  if (!runtime?.present) {
    return `
      <div class="configRuntime watchRuntime ${runtime?.tone ?? "neutral"}">
        <span>运行快照 ${runtime?.stateText ?? "暂无"}</span>
      </div>
    `;
  }
  const strategy = runtime.strategy ?? {};
  const dataSources = runtime.dataSources ?? {};
  const autoSell = runtime.autoSell ?? {};
  const restText = dataSources.restDiscoveryEnabled ? `${dataSources.restDiscoveryPollMs ?? "--"}ms` : "关";
  const entryText = `${runtimeSeconds(strategy.eventOpenWindowSeconds)} / 延迟 ${runtimeSeconds(strategy.eventBuyDelaySeconds)}`;
  return `
    <div class="configRuntime watchRuntime ${runtime.tone ?? "neutral"}">
      <span>Watch ${runtime.stateText ?? "--"}</span>
      <span>启动 ${runtime.startedAt ? formatDate(runtime.startedAt) : "--"}</span>
      <span>模式 ${runtime.mode ?? "--"}</span>
      <span>数据 ${dataSources.eventDiscovery ?? "--"} / ${dataSources.wsProvider ?? dataSources.primaryRpc ?? "--"}</span>
      <span>买入 ${strategy.eventOutcomeCount ?? "--"} 档 x ${strategy.stakePerOutcomeUsdt ?? "--"}U</span>
      <span>入场 ${entryText}</span>
      <span>时长 ≥ ${strategy.minMarketDurationHours ?? "--"}h</span>
      <span>范围 ${strategy.worldCupScoreMode ? "世界杯25项比分盘" : "常规"}</span>
      <span>手选 ${strategy.manualOutcomeSelectionMarkets ?? 0} 场</span>
      <span>REST ${restText}</span>
      <span>买 ${runtime.execution?.gasPriceGwei ?? "--"} / 卖 ${runtime.execution?.sellGasPriceGwei ?? runtime.execution?.gasPriceGwei ?? "--"} / 授权 ${runtime.execution?.operatorApproveGasPriceGwei ?? runtime.execution?.gasPriceGwei ?? "--"} gwei</span>
      <span>广播 ${dataSources.broadcastRpcCount ?? 0} 节点</span>
      <span>止盈 ${autoSellSummary(autoSell)}</span>
      <span>快照 ${runtime.file ?? "--"}</span>
    </div>
  `;
}

function runtimeSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? formatSeconds(number) : "--";
}

function autoSellSummary(autoSell) {
  if (!autoSell?.enabled) return "关";
  const parts = [];
  if (autoSell.originalEnabled) parts.push(`${autoSell.profitMultiplier}x/${autoSell.percent}%`);
  if (autoSell.fixedTrailing?.enabled) {
    parts.push(`固定${autoSell.fixedTrailing.armProfitPct}%/${autoSell.fixedTrailing.drawdownPct}%`);
  }
  if (autoSell.adaptiveTrailing?.enabled) parts.push("自适应");
  if (autoSell.weakExit?.enabled) parts.push("弱势");
  if (autoSell.breakeven?.enabled) parts.push("保本");
  if (autoSell.timedExit?.enabled) parts.push(`定时极速${autoSell.timedExit.afterOpenSeconds}s`);
  return parts.length ? parts.join(" / ") : "监控开";
}

function renderConfigField(field, value) {
  const id = `config_${field.key}`;
  if (field.type === "boolean" || field.type === "ack") {
    return `
      <label class="configField configToggle ${field.danger ? "danger" : ""}" for="${id}">
        <span>${escapeHtml(field.label)}</span>
        <span class="configSwitch">
          <input id="${id}" data-config-key="${field.key}" data-config-type="${field.type}" type="checkbox" ${truthy(value) ? "checked" : ""}>
          <span></span>
        </span>
      </label>
    `;
  }
  if (field.type === "select") {
    return `
      <label class="configField" for="${id}">
        <span>${escapeHtml(field.label)}</span>
        <select id="${id}" data-config-key="${field.key}" data-config-type="${field.type}">
          ${field.options.map((option) => `<option value="${escapeAttr(option)}" ${String(value) === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (field.type === "text" || field.type === "address") {
    return `
      <label class="configField" for="${id}">
        <span>${escapeHtml(field.label)}</span>
        <input id="${id}" data-config-key="${field.key}" data-config-type="${field.type}" type="text" value="${escapeAttr(value ?? "")}" ${field.type === "address" ? "spellcheck=\"false\" inputmode=\"text\"" : ""}>
      </label>
    `;
  }
  return `
    <label class="configField" for="${id}">
      <span>${escapeHtml(field.label)}</span>
      <input id="${id}" data-config-key="${field.key}" data-config-type="${field.type}" type="number" min="${field.min ?? ""}" max="${field.max ?? ""}" step="${field.step ?? "1"}" value="${escapeAttr(value ?? "")}">
    </label>
  `;
}

function bindConfigControls() {
  if (els.configForm) {
    els.configForm.addEventListener("click", (event) => {
      const walletSwitch = event.target.closest("[data-wallet-profile-activate]");
      if (walletSwitch) {
        event.preventDefault();
        activateWalletProfile();
        return;
      }
      const modeButton = event.target.closest("[data-buy-entry-mode]");
      if (modeButton) {
        event.preventDefault();
        applyBuyEntryMode(modeButton.dataset.buyEntryMode);
        return;
      }
      const button = event.target.closest("[data-config-group]");
      if (!button) return;
      event.preventDefault();
      setConfigGroup(button.dataset.configGroup);
    });
    els.configForm.addEventListener("input", (event) => {
      if (event.target.matches("[data-wallet-profile-select]")) {
        updateWalletProfileSwitchButton();
        return;
      }
      state.configDirty = true;
      updateBuyEntryModeCards();
    });
    els.configForm.addEventListener("change", (event) => {
      if (event.target.matches("[data-wallet-profile-select]")) updateWalletProfileSwitchButton();
    });
  }
  if (els.saveConfig) els.saveConfig.addEventListener("click", saveConfig);
  if (els.restartWatch) els.restartWatch.addEventListener("click", restartWatch);
}

function updateWalletProfileSwitchButton() {
  const select = els.configForm?.querySelector("[data-wallet-profile-select]");
  const button = els.configForm?.querySelector("[data-wallet-profile-activate]");
  if (!select || !button) return;
  const activeId = state.data?.settings?.config?.walletProfiles?.activeId ?? "";
  button.disabled = state.walletSwitching || !select.value || select.value === activeId;
}

async function activateWalletProfile() {
  if (state.configDirty) {
    showToast("请先保存当前配置，再切换钱包");
    return;
  }
  const select = els.configForm?.querySelector("[data-wallet-profile-select]");
  const button = els.configForm?.querySelector("[data-wallet-profile-activate]");
  if (!select || !button || !select.value) return;
  const profile = state.data?.settings?.config?.walletProfiles?.profiles?.find((item) => item.id === select.value);
  const name = profile ? `${profile.label}（${shortAddress(profile.address)}）` : select.value;
  if (!window.confirm(`切换到 ${name}？Watch 会重启，持仓和交易记录将切换到该钱包。`)) return;

  state.walletSwitching = true;
  state.walletDataGeneration += 1;
  state.operatorApprovals = {};
  state.overviewPendingForce = state.overviewLoading;
  state.positionsPendingForce = state.positionsLoading;
  button.disabled = true;
  setButtonLabel(button, "loader-circle", "切换中");
  setRestartStatus("正在切换钱包并重启 Watch...", "warn");
  try {
    const data = await api("/api/wallet/activate", {
      method: "POST",
      body: JSON.stringify({ profileId: select.value, confirm: "SWITCH_WALLET" })
    });
    if (state.data?.settings) state.data.settings.config = data.config;
    state.configRendered = false;
    renderConfig(data.config, state.data?.settings?.runtimeStatus, { force: true });
    setRestartStatus(data.message || "钱包已切换", data.bot?.running ? "good" : "warn");
    showToast(data.message || "钱包已切换");
    await loadOverview({ force: true });
    await loadPositions({ force: true });
  } catch (error) {
    setRestartStatus(error.message || "钱包切换失败", "bad");
    showToast(error.message || "钱包切换失败");
    await loadOverview({ force: true });
  } finally {
    state.walletSwitching = false;
    const currentButton = els.configForm?.querySelector("[data-wallet-profile-activate]");
    if (currentButton) setButtonLabel(currentButton, "refresh-cw", "切换并重启");
    updateWalletProfileSwitchButton();
  }
}

function applyBuyEntryMode(modeId) {
  const mode = BUY_ENTRY_MODES.find((item) => item.id === modeId);
  if (!mode) return;
  const preservedKeys = modeId === "anti" ? new Set(["EVENT_BUY_DELAY_SECONDS"]) : new Set();
  for (const [key, value] of Object.entries(mode.values)) {
    if (preservedKeys.has(key)) continue;
    setConfigInputValue(key, value);
  }
  state.configDirty = true;
  updateBuyEntryModeCards();
  showToast(`已套用${mode.label}参数${preservedKeys.size ? "，延迟秒数保持不变" : ""}；保存并重启 Watch 后生效`);
}

function setConfigInputValue(key, value) {
  const input = document.querySelector(`[data-config-key="${key}"]`);
  if (!input) return;
  if (input.type === "checkbox") {
    input.checked = truthy(value);
  } else {
    input.value = value ?? "";
  }
}

function updateBuyEntryModeCards() {
  const container = els.configForm?.querySelector("[data-buy-entry-current]");
  if (!container) return;
  const values = {};
  for (const field of CONFIG_FIELDS) {
    const input = document.querySelector(`[data-config-key="${field.key}"]`);
    if (!input) continue;
    values[field.key] = input.type === "checkbox" ? input.checked : input.value;
  }
  const activeMode = detectBuyEntryMode(values);
  container.dataset.buyEntryCurrent = activeMode;
  container.querySelectorAll("[data-buy-entry-mode]").forEach((button) => {
    const mode = BUY_ENTRY_MODES.find((item) => item.id === button.dataset.buyEntryMode);
    const active = button.dataset.buyEntryMode === activeMode;
    button.classList.toggle("isActive", active);
    const badge = button.querySelector(".buyEntryModeTop span");
    if (badge) badge.textContent = active ? "当前" : "套用";
    if (mode) button.setAttribute("aria-label", `${active ? "当前" : "套用"}${mode.label}`);
  });
}

function setConfigGroup(groupId) {
  const nextGroup = CONFIG_GROUPS.some((group) => group.id === groupId) ? groupId : CONFIG_GROUPS[0].id;
  state.configGroup = nextGroup;
  els.configForm?.querySelectorAll("[data-config-group]").forEach((button) => {
    const active = button.dataset.configGroup === nextGroup;
    button.classList.toggle("isActive", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  els.configForm?.querySelectorAll("[data-config-panel]").forEach((panel) => {
    panel.classList.toggle("isActive", panel.dataset.configPanel === nextGroup);
  });
}

async function saveConfig() {
  const values = {};
  for (const field of CONFIG_FIELDS) {
    const input = document.querySelector(`[data-config-key="${field.key}"]`);
    if (!input) continue;
    values[field.key] = field.type === "boolean" || field.type === "ack" ? input.checked : input.value;
  }
  els.saveConfig.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ values })
    });
    state.configDirty = false;
    renderConfig(data.config, state.data?.settings?.runtimeStatus, { force: true });
    setRestartStatus("配置已保存，重启 Watch 后生效", "warn");
    showToast("配置已保存，运行中的 watch 需重启生效");
    await loadOverview({ force: true });
  } catch (error) {
    setRestartStatus(error.message || "保存失败", "bad");
    showToast(error.message || "保存失败");
  } finally {
    els.saveConfig.disabled = false;
  }
}

async function restartWatch(options = {}) {
  if (state.configDirty) {
    setRestartStatus("有未保存配置，先保存再重启 Watch", "warn");
    showToast("先保存配置，再重启 Watch");
    return;
  }
  if (options?.confirm !== false && !window.confirm("重启 Watch 会让买入监控中断几秒，确认继续？")) return;

  els.restartWatch.disabled = true;
  setButtonLabel(els.restartWatch, "loader-circle", "重启中");
  setRestartStatus("Watch 正在重启...", "warn");
  try {
    const data = await api("/api/watch/restart", {
      method: "POST",
      body: "{}"
    });
    setRestartStatus(data.message || "Watch 已重启", data.bot?.running ? "good" : "warn");
    showToast(data.message || "Watch 已重启");
    setTimeout(() => loadOverview({ force: true }), 2500);
  } catch (error) {
    setRestartStatus(error.message || "重启失败", "bad");
    showToast(error.message || "重启失败");
  } finally {
    els.restartWatch.disabled = false;
    setButtonLabel(els.restartWatch, "refresh-cw", "重启 Watch");
  }
}

function setRestartStatus(message, tone = "neutral") {
  if (!els.restartStatus) return;
  els.restartStatus.textContent = message;
  els.restartStatus.className = `restartStatus ${tone}`;
}

function renderApprovalDefaults(data) {
  if (!els.approveAmount || document.activeElement === els.approveAmount) return;
  const current = Number(els.approveAmount.value);
  if (Number.isFinite(current) && current > 0) return;
  const values = data.settings?.config?.values ?? {};
  const configured = Number(data.wallet?.required ?? values.MAX_MARKET_STAKE_USDT ?? values.MAX_BATCH_STAKE_USDT ?? 25);
  els.approveAmount.value = Number.isFinite(configured) && configured > 0 ? String(configured) : "25";
}

function bindApprovalControls() {
  if (!els.approveRouter) return;
  els.approveRouter.addEventListener("click", approveRouter);
}

async function approveRouter() {
  const amount = Number(els.approveAmount?.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("请输入大于 0 的授权数量");
    return;
  }
  const confirmed = window.confirm(`这会提交真实链上授权交易，把 BUSDT Router 授权额度设置为 ${amount} U。继续？`);
  if (!confirmed) return;

  els.approveRouter.disabled = true;
  setButtonLabel(els.approveRouter, "loader-circle", "授权中");
  if (els.approveStatus) {
    els.approveStatus.textContent = "授权交易提交中...";
    els.approveStatus.className = "approvalStatus warn";
  }
  try {
    const data = await api("/api/approve", {
      method: "POST",
      body: JSON.stringify({ amountUsdt: amount })
    });
    let approval = data.approval ?? {};
    if (approval.taskId) {
      approval = await waitForRouterApprovalTask(approval.taskId);
    }
    const hashText = approval.approveHash ? ` · ${shortAddress(approval.approveHash)}` : "";
    const message = approval.alreadyReady
      ? `Router 授权额度已经是 ${approval.allowance} U`
      : `已提交授权 ${approval.allowance} U${hashText}`;
    if (els.approveStatus) {
      els.approveStatus.textContent = message;
      els.approveStatus.className = "approvalStatus good";
    }
    showToast(message);
    await loadOverview({ force: true });
  } catch (error) {
    if (els.approveStatus) {
      els.approveStatus.textContent = error.message || "授权失败";
      els.approveStatus.className = "approvalStatus bad";
    }
    showToast(error.message || "授权失败");
  } finally {
    els.approveRouter.disabled = false;
    setButtonLabel(els.approveRouter, "shield-check", "授权 BUSDT");
  }
}

async function waitForRouterApprovalTask(taskId) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const data = await api(`/api/wallet-actions/${encodeURIComponent(taskId)}`);
    if (els.approveStatus) {
      els.approveStatus.textContent = data.task.progress?.message || "授权任务排队中...";
      els.approveStatus.className = "approvalStatus warn";
    }
    if (data.task.terminal) {
      if (data.task.status === "failed") throw new Error(data.task.error || "BUSDT 授权失败");
      return data.approval ?? {};
    }
    await delay(500);
  }
  throw new Error("BUSDT 授权仍在后台执行");
}

function openSell(item) {
  state.selected = item;
  setSellPercent(100, { quote: false });
  setQuickSell(false, { quote: false });
  els.quickSellMinOut.value = state.quickSellMinOutUsdt;
  els.sellTitle.innerHTML = `${icon("badge-dollar-sign")}<span>卖出</span>`;
  els.sellOutcome.textContent = item.all ? "本市场全部仓位" : item.outcome;
  els.sellContext.innerHTML = `
    <div class="sellContextTitle" title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</div>
    <div class="sellContextGrid">
      <div class="stat"><span>当前价值</span><strong>${item.value} U</strong></div>
      <div class="stat"><span>盈亏</span><strong class="${item.positive ? "good" : "bad"}">${item.pnl} U</strong></div>
      <div class="stat"><span>收益</span><strong class="${item.positive ? "good" : "bad"}">${item.pnlPct}</strong></div>
      ${item.all ? `<div class="stat"><span>范围</span><strong>${item.positionCount} 个仓位</strong></div>` : ""}
    </div>
  `;
  els.quoteBox.innerHTML = `<div class="empty">报价中</div>`;
  setDrawerOpen(true);
  requestSellQuote();
}

function closeSell() {
  state.selected = null;
  state.quoteRequest += 1;
  clearTimeout(state.quoteTimer);
  setDrawerOpen(false);
}

async function requestSellQuote() {
  if (!state.selected) return;
  if (state.quickSell) {
    renderQuickSellWarning();
    return;
  }
  const requestId = ++state.quoteRequest;
  els.quoteBox.innerHTML = `<div class="empty">报价中</div>`;
  els.confirmSell.disabled = true;
  els.quoteRefresh.disabled = true;
  try {
    const data = await api("/api/sell/quote", {
      method: "POST",
      body: JSON.stringify(sellRequestPayload())
    });
    if (requestId !== state.quoteRequest) return;
    renderQuote(data.quote);
    els.confirmSell.disabled = false;
  } catch (error) {
    if (requestId !== state.quoteRequest) return;
    els.quoteBox.innerHTML = `<div class="empty">${escapeHtml(error.message || "报价失败")}</div>`;
  } finally {
    if (requestId === state.quoteRequest) els.quoteRefresh.disabled = false;
  }
}

function renderQuote(quote) {
  if (quote.quoteSkipped) {
    renderQuickSellWarning();
    return;
  }
  els.quoteBox.innerHTML = `
    <div class="quoteIntro">
      <strong>${formatPercent(state.sellPercent)} 仓位</strong>
      <span>${escapeHtml(quote.outcome || state.selected?.outcome || "")}</span>
      ${quote.positionCount > 1 ? `<span>${quote.positionCount} 个 outcome 依次卖出</span>` : ""}
      ${quote.sellAmountOt ? `<span>卖出 ${escapeHtml(quote.sellAmountOt)} / ${escapeHtml(quote.balanceOt)} OT</span>` : ""}
    </div>
    <div class="quoteLine"><span>预计到账</span><strong>${quote.expected} U</strong></div>
    <div class="quoteLine"><span>最低到账</span><strong>${quote.minimum} U</strong></div>
    <div class="quoteLine"><span>费用</span><strong>${quote.fee} U</strong></div>
    ${quote.needsApproval ? `<div class="quoteLine"><span>首次卖出</span><strong>会多做一次授权</strong></div>` : ""}
  `;
}

async function executeSell() {
  if (!state.selected) return;
  if (state.quickSell) {
    state.quickSellMinOutUsdt = String(els.quickSellMinOut.value || "0");
    const scope = selectedSellScopeText();
    const ok = window.confirm(`极速卖出将作用于：${scope}\n\n会跳过报价和卖出前模拟，按最低到帐 ${state.quickSellMinOutUsdt} U 直接广播。确认继续？`);
    if (!ok) return;
  }
  els.confirmSell.disabled = true;
  els.quoteRefresh.disabled = true;
  setButtonLabel(els.confirmSell, "loader-circle", "卖出中");
  let submitted = false;
  try {
    const data = await api("/api/sell/execute", {
      method: "POST",
      body: JSON.stringify(sellRequestPayload())
    });
    let sell = data.sell;
    if (sell.taskId) {
      sell = await waitForSellTask(sell.taskId);
    }
    const txText = sell.txHash ? ` · ${shortAddress(sell.txHash)}` : "";
    const received = sell.receivedText && sell.receivedText !== "未报价"
      ? `${sell.receivedText} U`
      : (sell.receivedText || "");
    showToast(`${sell.status}：${received}${txText}`);
    submitted = !["reverted", "failed"].includes(sell.rawStatus);
    if (!["reverted", "failed", "partial_failed"].includes(sell.rawStatus)) closeSell();
  } catch (error) {
    showToast(error.message || "卖出失败");
  } finally {
    els.confirmSell.disabled = false;
    els.quoteRefresh.disabled = false;
    setButtonLabel(els.confirmSell, "send", `确认卖出 ${formatPercent(state.sellPercent)}`);
  }
  if (submitted) {
    try {
      await loadOverview({ force: true });
    } catch {
      showToast("卖出已提交，但刷新数据失败");
    }
  }
}

function sellRequestPayload() {
  const payload = {
    market: state.selected.market,
    title: state.selected.title,
    outcome: state.selected.outcome,
    percent: state.sellPercent
  };
  if (state.selected.all) {
    payload.all = true;
  } else {
    payload.tokenId = state.selected.tokenId;
  }
  if (state.quickSell) {
    payload.quickSell = true;
    payload.minOutUsdt = String(els.quickSellMinOut.value || state.quickSellMinOutUsdt || "0");
  }
  return payload;
}

async function waitForSellTask(taskId) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const data = await api(`/api/wallet-actions/${encodeURIComponent(taskId)}`);
    renderSellTaskProgress(data.task);
    if (data.task.terminal) {
      if (!data.sell) throw new Error(data.task.error || "卖出任务没有返回结果");
      return data.sell;
    }
    await delay(500);
  }
  throw new Error("卖出任务仍在后台执行，请查看持仓或执行记录");
}

async function waitForOperatorApprovalTask(taskId, key) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const data = await api(`/api/wallet-actions/${encodeURIComponent(taskId)}`);
    state.operatorApprovals[key] = {
      loading: !data.task.terminal,
      pending: !data.task.terminal,
      approved: Boolean(data.operatorApproval?.approved || data.operatorApproval?.operatorApproved),
      error: data.task.error || ""
    };
    rerenderMarketViews();
    if (data.task.terminal) {
      if (data.task.status === "failed") throw new Error(data.task.error || "卖出授权失败");
      return data.operatorApproval ?? {};
    }
    await delay(500);
  }
  throw new Error("卖出授权仍在后台执行");
}

function renderSellTaskProgress(task) {
  const progress = task?.progress ?? {};
  const total = Number(progress.total ?? 0);
  const done = Number(progress.confirmed ?? 0) + Number(progress.broadcast ?? 0) + Number(progress.skipped ?? 0);
  const failed = Number(progress.failed ?? 0);
  const phaseText = task?.status === "queued"
    ? "等待 Watch 执行"
    : task?.status === "processing"
      ? "Watch 正在逐项卖出"
      : "卖出任务已结束";
  els.quoteBox.innerHTML = `
    <div class="quoteIntro">
      <strong>${escapeHtml(phaseText)}</strong>
      <span>${total ? `${done}/${total} 已处理${failed ? ` · ${failed} 失败` : ""}` : "正在读取剩余仓位"}</span>
    </div>
    ${(progress.items ?? []).map((item) => `
      <div class="quoteLine">
        <span>${escapeHtml(item.outcome || item.tokenId || "outcome")}</span>
        <strong>${escapeHtml(walletTaskStatusText(item.status))}${item.txHash ? ` · ${escapeHtml(shortAddress(item.txHash))}` : ""}</strong>
      </div>
    `).join("")}
  `;
  setButtonLabel(els.confirmSell, "loader-circle", total ? `卖出中 ${done}/${total}` : "卖出排队中");
}

function walletTaskStatusText(status) {
  if (status === "confirmed") return "已确认";
  if (status === "broadcast") return "已广播";
  if (status === "preparing") return "准备中";
  if (status === "skipped") return "已跳过";
  if (status === "failed" || status === "reverted") return "失败";
  return "排队中";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setSellPercent(value, { quote = true } = {}) {
  const percent = clampPercent(value);
  state.sellPercent = percent;
  els.sellPercentText.textContent = formatPercent(percent);
  els.sellPercentRange.value = String(percent);
  els.sellPercentInput.value = String(percent);
  for (const button of document.querySelectorAll("[data-sell-percent]")) {
    button.classList.toggle("isActive", Number(button.dataset.sellPercent) === percent);
  }
  setButtonLabel(els.confirmSell, "send", `确认卖出 ${formatPercent(percent)}`);
  if (quote && state.selected && !state.quickSell) {
    clearTimeout(state.quoteTimer);
    state.quoteTimer = setTimeout(() => requestSellQuote(), 300);
  } else if (state.quickSell) {
    renderQuickSellWarning();
  }
}

function setQuickSell(enabled, { quote = true } = {}) {
  state.quickSell = Boolean(enabled);
  els.quickSell.checked = state.quickSell;
  els.quickSellBox.classList.toggle("isDanger", state.quickSell);
  if (state.quickSell) {
    renderQuickSellWarning();
  } else if (quote && state.selected) {
    requestSellQuote();
  }
}

function renderQuickSellWarning() {
  state.quoteRequest += 1;
  clearTimeout(state.quoteTimer);
  state.quickSellMinOutUsdt = String(els.quickSellMinOut.value || state.quickSellMinOutUsdt || "0");
  const scope = selectedSellScopeText();
  els.confirmSell.disabled = false;
  els.quoteRefresh.disabled = true;
  els.quoteBox.innerHTML = `
    <div class="quoteIntro dangerText">
      <strong>极速卖出，不使用报价</strong>
      <span>范围：${escapeHtml(scope)}。最低到帐 ${escapeHtml(state.quickSellMinOutUsdt)} U；会跳过卖出前模拟，失败或严重滑点风险由这个 minOut 控制。</span>
      <span>如果需要确认预计到帐，关闭极速模式后重新报价。</span>
    </div>
  `;
}

function selectedSellScopeText() {
  if (!state.selected) return "当前仓位";
  if (state.selected.all) {
    const count = state.selected.positionCount ? ` ${state.selected.positionCount} 个` : "";
    return `本市场全部${count}仓位`;
  }
  return state.selected.outcome || "当前 outcome";
}

function setDrawerOpen(open) {
  els.sellDrawer.classList.toggle("isOpen", open);
  els.sellDrawer.setAttribute("aria-hidden", open ? "false" : "true");
  document.body.classList.toggle("drawerOpen", open);
}

function bindNavigation() {
  for (const button of document.querySelectorAll("[data-route]")) {
    button.addEventListener("click", () => {
      window.location.hash = `#/${button.dataset.route}`;
    });
  }
  for (const button of document.querySelectorAll("[data-market-filter]")) {
    button.addEventListener("click", () => {
      state.marketFilter = button.dataset.marketFilter;
      for (const item of document.querySelectorAll("[data-market-filter]")) {
        item.classList.toggle("isActive", item === button);
      }
      if (state.data) renderNewMarkets(state.data.newMarkets);
    });
  }
}

function bindSellControls() {
  els.closeDialog.addEventListener("click", closeSell);
  els.sellBackdrop.addEventListener("click", closeSell);
  els.confirmSell.addEventListener("click", executeSell);
  els.quoteRefresh.addEventListener("click", requestSellQuote);
  els.sellPercentRange.addEventListener("input", () => setSellPercent(els.sellPercentRange.value));
  els.sellPercentInput.addEventListener("input", () => setSellPercent(els.sellPercentInput.value));
  els.quickSell.addEventListener("change", () => setQuickSell(els.quickSell.checked));
  els.quickSellMinOut.addEventListener("input", () => {
    state.quickSellMinOutUsdt = String(els.quickSellMinOut.value || "0");
    if (state.quickSell) renderQuickSellWarning();
  });
  for (const button of document.querySelectorAll("[data-sell-percent]")) {
    button.addEventListener("click", () => setSellPercent(button.dataset.sellPercent));
  }
}

function setRoute(route, { replace = false } = {}) {
  const nextRoute = ROUTES[route] ? route : "overview";
  state.route = nextRoute;
  if (!replace && window.location.hash !== `#/${nextRoute}`) window.location.hash = `#/${nextRoute}`;
  document.body.dataset.route = nextRoute;
  for (const button of document.querySelectorAll("[data-route]")) {
    button.classList.toggle("isActive", button.dataset.route === nextRoute);
  }
  for (const view of document.querySelectorAll("[data-view]")) {
    view.classList.toggle("isActive", view.dataset.view === nextRoute);
  }
  const copy = ROUTES[nextRoute];
  els.viewKicker.textContent = copy.kicker;
  els.viewTitle.textContent = copy.title;
  els.viewLead.textContent = copy.lead;
}

function routeFromHash() {
  return window.location.hash.replace(/^#\/?/, "") || "overview";
}

function marketMatchesFilter(item, filter) {
  if (filter === "today") return isMarketToday(item);
  if (item.bucket) return filter === "all" || item.bucket === filter;
  if (filter === "all") return true;
  if (filter === "bought") return item.state === "已买";
  if (filter === "skipped") return item.state === "已跳过" || item.state === "已错过";
  if (filter === "pending") return !["已买", "已跳过", "已错过"].includes(item.state);
  return true;
}

function compareMarketsByOpenTime(a, b) {
  const at = marketOpenTimeMs(a);
  const bt = marketOpenTimeMs(b);
  if (at !== bt) return bt - at;
  return String(a?.title ?? "").localeCompare(String(b?.title ?? ""), "zh-CN");
}

function marketOpenTimeMs(item) {
  const time = new Date(item?.startsAt ?? "").getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function isMarketToday(item) {
  const date = shanghaiDateKey(item?.startsAt);
  return Boolean(date) && date === shanghaiDateKey(new Date());
}

function shanghaiDateKey(value) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function marketStateTone(tone) {
  if (tone === "good") return "stateGood";
  if (tone === "warn") return "stateWarn";
  if (tone === "bad") return "stateBad";
  return "stateNeutral";
}

function summaryCard(label, value, meta, positive) {
  return `
    <div class="summaryCard">
      <span>${escapeHtml(label)}</span>
      <strong class="${positive ? "goodish" : "bad"}">${escapeHtml(value)}</strong>
      <small class="${positive ? "good" : "bad"}">${escapeHtml(meta)}</small>
    </div>
  `;
}

function splitActivityTitle(value) {
  const parts = String(value ?? "").split(" / ");
  return {
    main: parts[0] ?? "",
    detail: parts.slice(1).join(" / ")
  };
}

function activityTone(label) {
  if (label === "卖出") return "sell";
  if (label === "买入" || label === "买入成功") return "buy";
  if (label === "买入失败") return "badTone";
  if (label === "等待确认") return "wait";
  return "neutral";
}

function updateCountdowns() {
  if (els.nextClock.dataset.startsAt) {
    els.nextClock.textContent = countdown(els.nextClock.dataset.startsAt);
  } else {
    els.nextClock.textContent = "--";
  }
  for (const el of document.querySelectorAll("[data-countdown]")) {
    el.textContent = countdown(el.dataset.countdown);
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.message || "请求失败");
  return data;
}

function countdown(value) {
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) return "--";
  if (diff <= 0) return "已开";
  const total = Math.floor(diff / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}天 ${hours}时`;
  if (hours > 0) return `${hours}时 ${mins}分`;
  return `${mins}分 ${secs}秒`;
}

function formatDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function marketDurationLabel(item) {
  const hours = Number(item?.durationHours);
  if (!Number.isFinite(hours) || hours <= 0) return item?.duration || "--";
  if (hours < 24) return `${formatCompactNumber(hours)}小时`;
  return `${formatCompactNumber(hours / 24)}天`;
}

function formatCompactNumber(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(rounded)) return "--";
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0$/u, "");
}

function formatTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 100;
  return Math.min(100, Math.max(1, Math.round(number)));
}

function formatPercent(value) {
  return `${clampPercent(value)}%`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function renderStaticIcons() {
  for (const el of document.querySelectorAll("[data-icon]")) {
    el.innerHTML = icon(el.dataset.icon);
  }
}

function setButtonLabel(button, iconName, label) {
  button.innerHTML = `${icon(iconName)}<span>${escapeHtml(label)}</span>`;
}

function icon(name, className = "icon") {
  const body = ICONS[name] ?? "";
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function truthy(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value ?? "").toLowerCase());
}

function shortAddress(value) {
  const text = String(value ?? "");
  if (text.length <= 12) return text || "--";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function marketKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sameWalletAddress(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
