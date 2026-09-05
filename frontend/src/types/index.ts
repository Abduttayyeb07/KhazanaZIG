export interface DashboardExchange {
  wsStatus: "CONNECTED" | "RECONNECTING" | "DISCONNECTED";
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  spreadBps: number | null;
  midPrice: number | null;
  imbalanceRatio: number | null;
  regime: string | null;
  freshnessMs: number | null;
}

export interface DashboardEvent {
  time: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface DashboardBalance {
  exchange: string;
  asset: string;
  available: number;
  locked: number;
  total: number;
  fetchedAt: number;
}

export interface DashboardOrder {
  exchange: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  filledSize: number;
  remainingSize: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardFill {
  exchange: string;
  fillId: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  fee: number;
  feeAsset: string;
  filledAt: number;
}

export interface DashboardReconciliation {
  timestamp: number;
  exchange: string;
  status: string;
  issues: Array<{
    category: string;
    status: string;
    detail: string;
    field?: string;
    expected?: string | number;
    actual?: string | number;
  }>;
  requiresExecutionHalt: boolean;
  repaired: boolean;
}

export interface DashboardAccountState {
  balances: {
    bybit: DashboardBalance[];
    mexc: DashboardBalance[];
  };
  openOrders: {
    bybit: DashboardOrder[];
    mexc: DashboardOrder[];
  };
  fills: {
    bybit: DashboardFill[];
    mexc: DashboardFill[];
  };
  reconciliation: {
    bybit: DashboardReconciliation | null;
    mexc: DashboardReconciliation | null;
  };
}

export interface DashboardTreasury {
  baseAsset: string;
  quoteAsset: string;
  reserveFloor: number;
  totalBase: number;
  activeBase: number;
  reserveBase: number;
  avgCost: number;
  realizedPnlUsdt: number;
  totalFeesUsdt: number;
  markPrice: number | null;
  unrealizedPnlUsdt: number | null;
  inventoryValueUsdt: number | null;
  fillCount: number;
  lastFillAt: number | null;
}

export interface DashboardManagedOrder {
  clientOrderId: string;
  exchange: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  filledQuantity: number;
  status: string;
  source: string;
  reason: string;
  createdAt: number;
}

export interface SoakAllowed {
  harvestSell: boolean;
  harvestRebuy: boolean;
  accumulationBuy: boolean;
  accumulationRecoverySell: boolean;
}

export interface SoakFill {
  side: "buy" | "sell";
  qty: number;
  price: number;
  at: number;
  kind: string;
}

// Live view of the paper simulation. `running: false` is the normal idle state —
// the soak exists only between an explicit START and STOP.
export interface DashboardSoak {
  running: boolean;
  runId: string | null;
  startedAt: number | null;

  zone: string | null;
  zoneReason: string | null;
  harvestAggression: "FULL" | "REDUCED" | null;
  breakoutCandidate: boolean;
  allowed: SoakAllowed | null;

  zig: number;
  usdt: number;
  activeZig: number;
  reserveZig: number;
  avgCost: number;
  markPrice: number | null;

  nav: number | null;
  baselineNav: number | null;
  navDelta: number | null;

  harvest: {
    openCycles: number;
    completedCycles: number;
    completionRate: number;
    harvestedUsdt: number;
    unrecoveredZig: number;
    nearestRebuyTarget: number | null;
    sells: number;
    buys: number;
  };

  accumulation: {
    enabled: boolean;
    openLots: number;
    recoveredLots: number;
    usdtDeployed: number;
    usdtRecovered: number;
    surplusZig: number;
    openExposureUsdt: number;
    budgetRemaining: number;
    dailyRemaining: number;
    recycled: number;
  } | null;

  recentFills: SoakFill[];
  blocked: Array<{ reason: string; count: number }>;
}

// Zone boundaries as the ENGINE has them. The chart draws these rather than its
// own copy, so the picture can never disagree with the classifier.
export interface DashboardZones {
  activeBandLow: number;
  activeBandHigh: number;
  zoneALow: number;
  zoneAHigh: number;
  zoneBLow: number;
  zoneBHigh: number;
  zoneCLow: number;
  zoneCHigh: number;
  reserveFloor: number;
}

export interface DashboardState {
  mode: string;
  hasSession: boolean;
  symbol: string;
  zones: DashboardZones;
  exchanges: {
    bybit: DashboardExchange;
    mexc: DashboardExchange;
  };
  account: DashboardAccountState;
  treasury: DashboardTreasury | null;
  execution: { managedOrders: DashboardManagedOrder[] };
  soak: DashboardSoak;
  events: DashboardEvent[];
  startedAt: number;
  updatedAt: number;
}
