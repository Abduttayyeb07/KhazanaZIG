import assert from "node:assert/strict";
import type { ExecutionRequest, ManagedOrder, NormalizedMarketState } from "@zig/shared-types";
import type { SystemState } from "../state-engine/store.js";
import { RiskEngine } from "./risk-engine.js";
import type { RiskConfig } from "./risk-types.js";

const cfg: RiskConfig = {
  maxOrderActivePct: 0.05,
  maxDailySellActivePct: 0.15,
  maxDailyBuyUsdtPct: 0.25,
  liquidityParticipationPct: 0.1,
  defensiveSizeMultiplier: 0.35,
  highVolSizeMultiplier: 0.4,
  chaoticSizeMultiplier: 0,
  minOrderZig: 100,
  maxOpenOrdersPerExchange: 5,
  minSellProfitBps: 300,
  minRebuyDistanceBps: 300,
  maxSpreadBps: 150,
  chaoticSpreadMultiplier: 3,
  max15mMovePct: 0.08,
  lowVolAtrPct: 0.01,
  normalVolAtrPct: 0.03,
  highVolAtrPct: 0.07,
  maxReconnectsPer5m: 5,
  reconciliationRequiredStatus: "MATCH",
  baseAsset: "ZIG",
  quoteAsset: "USDT",
  reserveFloor: 5_000_000,
};

const engine = new RiskEngine(cfg);

function market(overrides: Partial<NormalizedMarketState> = {}): NormalizedMarketState {
  return {
    exchange: "bybit",
    symbol: "ZIGUSDT",
    timestamp: Date.now(),
    bestBid: 0.11,
    bestAsk: 0.111,
    spread: 0.001,
    spreadBps: 90,
    midPrice: 0.1105,
    bidLiquidity: 1_000_000,
    askLiquidity: 1_000_000,
    imbalanceRatio: 0,
    volatilityRegime: "NORMAL",
    orderbookFreshnessMs: 100,
    websocketStatus: "CONNECTED",
    sequenceStatus: "HEALTHY",
    lastSequence: 1,
    ...overrides,
  };
}

function state(overrides: Partial<SystemState> = {}): SystemState {
  return {
    market: { bybit: market(), mexc: null },
    balances: {
      bybit: [
        { exchange: "bybit", asset: "ZIG", available: 5_050_000, locked: 0, total: 5_050_000, fetchedAt: Date.now() },
        { exchange: "bybit", asset: "USDT", available: 100_000, locked: 0, total: 100_000, fetchedAt: Date.now() },
      ],
      mexc: [],
    },
    openOrders: { bybit: [], mexc: [] },
    fills: {
      bybit: [{ exchange: "bybit", fillId: "b1", orderId: "o1", clientOrderId: "c1", symbol: "ZIGUSDT", side: "buy", price: 0.1, size: 5_050_000, fee: 0, feeAsset: "USDT", filledAt: Date.now() - 1_000 }],
      mexc: [],
    },
    lastReconciliation: {
      bybit: { exchange: "bybit", status: "MATCH", issues: [], requiresExecutionHalt: false, repaired: false, timestamp: Date.now() },
      mexc: null,
    },
    mode: "NORMAL",
    recoveryComplete: true,
    lastStateUpdateAt: Date.now(),
    ...overrides,
  };
}

function req(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    requestId: `r-${Math.random()}`,
    exchange: "bybit",
    symbol: "ZIGUSDT",
    side: "sell",
    type: "LIMIT",
    quantity: 10_000,
    price: 0.12,
    tif: "GTC",
    source: "OPERATOR",
    reason: "test",
    createdAt: Date.now(),
    ...overrides,
  };
}

function orders(n: number): ManagedOrder[] {
  return Array.from({ length: n }, (_, i) => ({
    clientOrderId: `c-${i}`,
    requestId: `r-${i}`,
    exchange: "bybit",
    symbol: "ZIGUSDT",
    side: "sell",
    price: 0.12,
    quantity: 100,
    filledQuantity: 0,
    status: "OPEN",
    source: "OPERATOR",
    reason: "test",
    exchangeOrderId: null,
    paper: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
}

{
  const decision = engine.evaluate(req({ quantity: 100_000 }), state(), []);
  assert.equal(decision.decision, "REDUCE");
  assert.equal(decision.approvedQty, 2_500);
  assert.ok(decision.reasons.includes("MAX_ORDER_ACTIVE_PCT"));
}

{
  const decision = engine.evaluate(req({ quantity: 10 }), state(), []);
  assert.equal(decision.decision, "REJECT");
  assert.ok(decision.reasons.includes("BELOW_MIN_ORDER_ZIG"));
}

{
  const decision = engine.evaluate(req(), state({ mode: "READ_ONLY" }), []);
  assert.equal(decision.decision, "REJECT");
  assert.ok(decision.reasons.includes("MODE_READ_ONLY"));
}

{
  const decision = engine.evaluate(req(), state({ mode: "DEFENSIVE" }), []);
  assert.equal(decision.decision, "REDUCE");
  assert.ok(decision.reasons.includes("MODE_MULTIPLIER"));
}

{
  const decision = engine.evaluate(req(), state({ lastReconciliation: { bybit: { exchange: "bybit", status: "SOFT_DRIFT", issues: [], requiresExecutionHalt: false, repaired: false, timestamp: Date.now() }, mexc: null } }), []);
  assert.equal(decision.decision, "REJECT");
  assert.ok(decision.reasons.includes("RECONCILIATION_SOFT_DRIFT"));
}

{
  const decision = engine.evaluate(req(), state({ lastReconciliation: { bybit: { exchange: "bybit", status: "CRITICAL_DRIFT", issues: [], requiresExecutionHalt: true, repaired: false, timestamp: Date.now() }, mexc: null } }), []);
  assert.equal(decision.decision, "HALT");
  assert.ok(decision.reasons.includes("CRITICAL_RECONCILIATION_DRIFT"));
}

{
  const decision = engine.evaluate(req(), state({ market: { bybit: market({ volatilityRegime: "CHAOTIC", spreadBps: 200 }), mexc: null } }), []);
  assert.equal(decision.decision, "REJECT");
  assert.ok(decision.reasons.includes("SPREAD_TOO_WIDE"));
}

{
  const decision = engine.evaluate(req(), state(), orders(5));
  assert.equal(decision.decision, "REJECT");
  assert.ok(decision.reasons.includes("MAX_OPEN_ORDERS_PER_EXCHANGE"));
}

console.log("risk-engine tests passed");
