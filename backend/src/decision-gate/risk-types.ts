import type { ExecutionRequest, NormalizedMarketState, OperationalMode, DriftStatus, Exchange } from "@zig/shared-types";

export type RiskDecisionType = "ALLOW" | "REDUCE" | "REJECT" | "HALT";
export type RiskSeverity = "INFO" | "WARN" | "CRITICAL";

export interface RiskDecision {
  decision: RiskDecisionType;
  requestedQty: number;
  approvedQty: number;
  reasons: string[];
  severity: RiskSeverity;
  metadata?: Record<string, unknown>;
}

export interface RiskConfig {
  maxOrderActivePct: number;
  maxDailySellActivePct: number;
  maxDailyBuyUsdtPct: number;
  liquidityParticipationPct: number;
  defensiveSizeMultiplier: number;
  highVolSizeMultiplier: number;
  chaoticSizeMultiplier: number;
  minOrderZig: number;
  maxOpenOrdersPerExchange: number;
  minSellProfitBps: number;
  minRebuyDistanceBps: number;
  maxSpreadBps: number;
  chaoticSpreadMultiplier: number;
  max15mMovePct: number;
  lowVolAtrPct: number;
  normalVolAtrPct: number;
  highVolAtrPct: number;
  maxReconnectsPer5m: number;
  reconciliationRequiredStatus: "MATCH";
  baseAsset: string;
  quoteAsset: string;
  reserveFloor: number;
}

export interface RiskContext {
  request: ExecutionRequest;
  mode: OperationalMode;
  marketState: NormalizedMarketState | null;
  treasuryState: {
    totalZig: number;
    activeInventory: number;
    reserveInventory: number;
    reserveFloor: number;
    usdtBalance: number;
    averageCost?: number;
  };
  reconciliationStatus: DriftStatus | null;
  exchangeHealth: {
    websocketHealthy: boolean;
    sequenceHealthy: boolean;
    reconnectsLast5m: number;
    stale: boolean;
  };
  openOrdersCount: number;
  dailySellUsedZig: number;
  dailyBuyUsedUsdt: number;
  liquidity: {
    nearbyBidLiquidityZig: number;
    nearbyAskLiquidityZig: number;
    nearbyBidLiquidityUsdt: number;
    nearbyAskLiquidityUsdt: number;
  };
}

export interface RiskContextInput {
  request: ExecutionRequest;
  exchange: Exchange;
}

export function allowDecision(requestedQty: number, reasons: string[] = ["RISK_CHECKS_PASSED"]): RiskDecision {
  return { decision: "ALLOW", requestedQty, approvedQty: requestedQty, reasons, severity: "INFO" };
}

export function rejectDecision(requestedQty: number, reasons: string[], metadata?: Record<string, unknown>): RiskDecision {
  return { decision: "REJECT", requestedQty, approvedQty: 0, reasons, severity: "WARN", metadata };
}

export function haltDecision(requestedQty: number, reasons: string[], metadata?: Record<string, unknown>): RiskDecision {
  return { decision: "HALT", requestedQty, approvedQty: 0, reasons, severity: "CRITICAL", metadata };
}
