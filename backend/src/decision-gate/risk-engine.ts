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

  // PAPER_MODE deliberately skips a few gates that cannot be satisfied without a real
  // exchange session. That makes the soak MORE permissive than NORMAL, so a paper run
  // can "pass" on trades NORMAL would refuse. The relaxations are therefore recorded
  // on every decision (metadata.paperRelaxations) instead of being silent — the soak
  // reporter surfaces them, so nobody reads a paper result as a live dress rehearsal.
  evaluate(request: ExecutionRequest, state: SystemState, openOrders: ManagedOrder[]): RiskDecision {
    const malformed = validateExecutionRequest(request);
    if (malformed.length > 0) return rejectDecision(request.quantity, malformed);

    const ctx = buildRiskContext(request, state, openOrders, this.cfg);
    const relaxations: string[] = [];

    const hardGate = this.runHardGates(ctx, relaxations);
    if (hardGate) return withRelaxations(hardGate, relaxations);

    const policyReject = this.runPolicies(ctx, relaxations);
    if (policyReject) return withRelaxations(policyReject, relaxations);

    const regime = classifyContextVolatility(ctx, this.cfg);
    if (regime === "CHAOTIC" && this.cfg.chaoticSizeMultiplier <= 0) {
      return withRelaxations(rejectDecision(ctx.request.quantity, ["CHAOTIC_VOLATILITY"], { regime }), relaxations);
    }

    const sized = this.sizing.size(ctx, regime);
    if (sized.decision === "ALLOW") {
      return withRelaxations(allowDecision(ctx.request.quantity, ["RISK_CHECKS_PASSED"]), relaxations);
    }
    return withRelaxations(sized, relaxations);
  }

  private runHardGates(ctx: RiskContext, relaxations: string[]): RiskDecision | null {
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
    } else {
      // Paper has no exchange orders to reconcile against — the gate is inapplicable,
      // not passed. NORMAL would refuse this trade until reconciliation reports MATCH.
      relaxations.push("SKIPPED_RECONCILIATION_GATE");
    }

    return null;
  }

  private runPolicies(ctx: RiskContext, relaxations: string[]): RiskDecision | null {
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
      if (ctx.treasuryState.averageCost === undefined) {
        if (ctx.mode !== "PAPER_MODE") return rejectDecision(qty, ["MISSING_AVERAGE_COST"]);
        relaxations.push("SKIPPED_MISSING_AVERAGE_COST");
      }
      if (ctx.treasuryState.averageCost !== undefined) {
        const profitBps = ((ctx.request.price - ctx.treasuryState.averageCost) / ctx.treasuryState.averageCost) * 10_000;
        if (profitBps < this.cfg.minSellProfitBps) {
          // By design (zone-anchored harvesting) paper sells are not cost-anchored —
          // profit comes from the sell→rebuy spread, not from price-vs-avgCost. NORMAL
          // still enforces the floor, so record every sell that only paper would allow.
          if (ctx.mode !== "PAPER_MODE") {
            return rejectDecision(qty, ["MIN_SELL_PROFIT_BPS"], { profitBps, requiredBps: this.cfg.minSellProfitBps });
          }
          relaxations.push("SKIPPED_MIN_SELL_PROFIT_BPS");
        }
      }
    }

    // Enforced in paper too: the virtual account carries real virtual USDT, so an
    // unfunded buy is a genuine error rather than an inapplicable gate.
    if (ctx.request.side === "buy" && ctx.treasuryState.usdtBalance <= 0) {
      return rejectDecision(qty, ["NO_USDT_BALANCE"]);
    }

    return null;
  }
}

// Attach the paper-mode relaxations to a decision without disturbing its own metadata.
function withRelaxations(decision: RiskDecision, relaxations: string[]): RiskDecision {
  if (relaxations.length === 0) return decision;
  return { ...decision, metadata: { ...decision.metadata, paperRelaxations: [...new Set(relaxations)] } };
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
