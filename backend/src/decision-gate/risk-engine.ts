import type { ExecutionRequest } from "@zig/shared-types";
import type { SystemState } from "../state-engine/store.js";
import type { ManagedOrder } from "@zig/shared-types";
import type { RiskConfig, RiskContext, RiskDecision } from "./risk-types.js";
import { allowDecision, haltDecision, rejectDecision } from "./risk-types.js";
import { buildRiskContext } from "./risk-context.js";
import { classifyContextVolatility } from "./regime/volatility-classifier.js";
import { SizingEngine } from "./sizing/sizing-engine.js";

export class RiskEngine {
  private readonly cfg: RiskConfig;
  private readonly sizing: SizingEngine;

  constructor(cfg: RiskConfig) {
    this.cfg = cfg;
    this.sizing = new SizingEngine(cfg);
  }

  evaluate(request: ExecutionRequest, state: SystemState, openOrders: ManagedOrder[]): RiskDecision {
    const malformed = validateExecutionRequest(request);
    if (malformed.length > 0) return rejectDecision(request.quantity, malformed);

    const ctx = buildRiskContext(request, state, openOrders, this.cfg);
    const hardGate = this.runHardGates(ctx);
    if (hardGate) return hardGate;

    const policyReject = this.runPolicies(ctx);
    if (policyReject) return policyReject;

    const regime = classifyContextVolatility(ctx, this.cfg);
    if (regime === "CHAOTIC" && this.cfg.chaoticSizeMultiplier <= 0) {
      return rejectDecision(ctx.request.quantity, ["CHAOTIC_VOLATILITY"], { regime });
    }

    const sized = this.sizing.size(ctx, regime);
    if (sized.decision === "ALLOW") return allowDecision(ctx.request.quantity, ["RISK_CHECKS_PASSED"]);
    return sized;
  }

  private runHardGates(ctx: RiskContext): RiskDecision | null {
    const qty = ctx.request.quantity;

    if (ctx.mode === "HALT") return rejectDecision(qty, ["MODE_HALT"]);
    if (ctx.mode === "READ_ONLY") return rejectDecision(qty, ["MODE_READ_ONLY"]);

    if (!ctx.marketState) return rejectDecision(qty, ["MISSING_MARKET_STATE"]);
    if (!ctx.exchangeHealth.websocketHealthy) return rejectDecision(qty, ["WEBSOCKET_UNHEALTHY"]);
    if (!ctx.exchangeHealth.sequenceHealthy) return rejectDecision(qty, ["SEQUENCE_UNHEALTHY"]);
    if (ctx.exchangeHealth.stale) return rejectDecision(qty, ["STALE_MARKET_STATE"]);
    if (ctx.exchangeHealth.reconnectsLast5m > this.cfg.maxReconnectsPer5m) {
      return haltDecision(qty, ["EXCESSIVE_RECONNECTS"], {
        reconnectsLast5m: ctx.exchangeHealth.reconnectsLast5m,
        maxReconnectsPer5m: this.cfg.maxReconnectsPer5m,
      });
    }

    if (ctx.reconciliationStatus === "CRITICAL_DRIFT") return haltDecision(qty, ["CRITICAL_RECONCILIATION_DRIFT"]);
    if (ctx.mode !== "PAPER_MODE") {
      if (!ctx.reconciliationStatus) return rejectDecision(qty, ["MISSING_RECONCILIATION_STATUS"]);
      if (ctx.reconciliationStatus !== this.cfg.reconciliationRequiredStatus) {
        return rejectDecision(qty, [`RECONCILIATION_${ctx.reconciliationStatus}`]);
      }
    }

    return null;
  }

  private runPolicies(ctx: RiskContext): RiskDecision | null {
    const qty = ctx.request.quantity;

    if (ctx.openOrdersCount >= this.cfg.maxOpenOrdersPerExchange) {
      return rejectDecision(qty, ["MAX_OPEN_ORDERS_PER_EXCHANGE"], {
        openOrdersCount: ctx.openOrdersCount,
        limit: this.cfg.maxOpenOrdersPerExchange,
      });
    }

    if (ctx.marketState && ctx.marketState.spreadBps > this.cfg.maxSpreadBps) {
      return rejectDecision(qty, ["SPREAD_TOO_WIDE"], {
        spreadBps: ctx.marketState.spreadBps,
        maxSpreadBps: this.cfg.maxSpreadBps,
      });
    }

    if (ctx.request.side === "sell") {
      if (ctx.treasuryState.activeInventory <= 0) return rejectDecision(qty, ["NO_ACTIVE_INVENTORY"]);
      const maxSafeSell = ctx.treasuryState.activeInventory;
      if (maxSafeSell < this.cfg.minOrderZig) return rejectDecision(qty, ["RESERVE_FLOOR_NO_SAFE_SIZE"]);
      if (ctx.treasuryState.averageCost === undefined && ctx.mode !== "PAPER_MODE") {
        return rejectDecision(qty, ["MISSING_AVERAGE_COST"]);
      }
      if (ctx.treasuryState.averageCost !== undefined) {
        const profitBps = ((ctx.request.price - ctx.treasuryState.averageCost) / ctx.treasuryState.averageCost) * 10_000;
        if (profitBps < this.cfg.minSellProfitBps && ctx.mode !== "PAPER_MODE") {
          return rejectDecision(qty, ["MIN_SELL_PROFIT_BPS"], { profitBps, requiredBps: this.cfg.minSellProfitBps });
        }
      }
    }

    if (ctx.request.side === "buy" && ctx.treasuryState.usdtBalance <= 0 && ctx.mode !== "PAPER_MODE") {
      return rejectDecision(qty, ["NO_USDT_BALANCE"]);
    }

    return null;
  }
}

function validateExecutionRequest(request: ExecutionRequest): string[] {
  const reasons: string[] = [];
  if (!request.requestId) reasons.push("MISSING_REQUEST_ID");
  if (request.exchange !== "bybit" && request.exchange !== "mexc") reasons.push("INVALID_EXCHANGE");
  if (request.side !== "buy" && request.side !== "sell") reasons.push("INVALID_SIDE");
  if (request.type !== "LIMIT") reasons.push("ONLY_LIMIT_ORDERS_SUPPORTED");
  if (!Number.isFinite(request.quantity) || request.quantity <= 0) reasons.push("INVALID_QUANTITY");
  if (!Number.isFinite(request.price) || request.price <= 0) reasons.push("INVALID_PRICE");
  return reasons;
}
