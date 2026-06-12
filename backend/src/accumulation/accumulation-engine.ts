import { randomUUID } from "crypto";
import type { Logger } from "@zig/logger";
import type { Exchange, ExecutionRequest, VolatilityRegime } from "@zig/shared-types";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { RiskDecision } from "../decision-gate/risk-types.js";
import type { AllowedActions } from "../zone-manager/zone-types.js";
import { priceBucketId } from "../paper-soak/cycle-tracker.js";
import { AccumulationCycleTracker } from "./accumulation-cycle-tracker.js";
import { AccumulationBudget } from "./accumulation-budget.js";
import { recoverySellQty } from "./accumulation-recovery.js";
import type { AccumulationMetrics } from "./accumulation-types.js";

// ── Accumulation engine ─────────────────────────────────────────────────────────
//
// Generates accumulation BUY intents (Zone A weakness) and RECOVERY SELL intents
// (price back above a lot's target). Every intent still flows through the real
// ExecutionPipeline → RiskEngine → Sizing — never bypassed. Tick order is owned by
// the driver: recovery sells are attempted before fresh buys.
// ──────────────────────────────────────────────────────────────────────────────

export interface AccTickContext {
  bid: number;
  ask: number;
  spreadBps: number;
  liquidityUsdt: number;
  regime: VolatilityRegime;
  allowed: AllowedActions;
  usdtBalance: number;
  harvestRebuyReserve: number; // USDT earmarked to finish open harvest cycles (priority over accumulation)
  now: number;
}

export interface AccBuyInfo { cycleId: string; qty: number; price: number; usdtSpent: number; fee: number; recoveryTarget: number; budgetRemaining: number; }
export interface AccRecoveryInfo { qty: number; price: number; fee: number; }

export interface AccReporter {
  decision(intent: { side: "buy" | "sell"; quantity: number; price: number }, d: RiskDecision): void;
  intentBlocked(reason: string): void;
  accBuy(info: AccBuyInfo): void;
  accRecovery(info: AccRecoveryInfo): void;
}

export interface AccumulationParams {
  exchange: Exchange;
  symbol: string;
  enabled: boolean;
  recoveryEnabled: boolean;
  trancheUsdt: number;
  cooldownMs: number;
  bucketBps: number;
  minLiquidityUsdt: number;
  maxSpreadBps: number;
  allowHighVol: boolean;
  allowChaotic: boolean;
  minUsdtFloor: number;
  principalRecoveryPct: number;
  takerFeeBps: number;
  minOrderZig: number;
}

export class AccumulationEngine {
  private cooldownUntil = 0;
  private readonly bucketUntil = new Map<number, number>();
  private readonly log: Logger;

  constructor(
    private readonly pipeline: ExecutionPipeline,
    readonly tracker: AccumulationCycleTracker,
    private readonly budget: AccumulationBudget,
    private readonly reporter: AccReporter,
    private readonly p: AccumulationParams,
    log: Logger
  ) {
    this.log = log.child({ module: "accumulation-engine" });
  }

  // Returns true iff an intent was submitted this tick (the driver's action slot is used).
  async attemptRecoverySell(ctx: AccTickContext): Promise<boolean> {
    if (!this.p.recoveryEnabled) return false;
    if (!ctx.allowed.accumulationRecoverySell) { this.reporter.intentBlocked("ZONE_BLOCKED_ACTION"); return false; }
    const eligible = this.tracker.openForRecovery(ctx.bid);
    if (eligible.length === 0) {
      const m = this.tracker.metrics();
      this.reporter.intentBlocked(m.openCount === 0 ? "NO_ACCUMULATION_CYCLE" : "ACCUMULATION_RECOVERY_NOT_READY");
      return false;
    }
    const c = eligible[0];
    const qty = recoverySellQty(c.usdtSpent, this.p.principalRecoveryPct, c.usdtRecovered, ctx.bid);
    if (qty <= 0) return false;
    // Slippage leaves a tiny principal residue after the main recovery sell; sizing
    // REJECTS sub-min-order dust, and resubmitting it every tick (returning true)
    // would starve harvest sells and accumulation buys indefinitely. Skip dust
    // without consuming the tick's action slot.
    if (qty < this.p.minOrderZig) {
      this.reporter.intentBlocked("ACCUMULATION_RECOVERY_DUST");
      return false;
    }
    await this.submit("sell", qty, ctx.bid, "acc-recovery");
    return true;
  }

  async attemptBuy(ctx: AccTickContext): Promise<boolean> {
    if (!this.p.enabled) return false;
    if (!ctx.allowed.accumulationBuy) { this.reporter.intentBlocked("ZONE_BLOCKED_ACTION"); return false; }
    if (ctx.regime === "CHAOTIC" && !this.p.allowChaotic) { this.reporter.intentBlocked("ACCUMULATION_CHAOTIC"); return false; }
    if (ctx.regime === "HIGH" && !this.p.allowHighVol) { this.reporter.intentBlocked("ACCUMULATION_HIGH_VOL"); return false; }
    if (ctx.spreadBps > this.p.maxSpreadBps) { this.reporter.intentBlocked("ACCUMULATION_SPREAD_TOO_WIDE"); return false; }
    if (ctx.liquidityUsdt < this.p.minLiquidityUsdt) { this.reporter.intentBlocked("ACCUMULATION_LIQUIDITY_LOW"); return false; }
    if (ctx.now < this.cooldownUntil) { this.reporter.intentBlocked("ACCUMULATION_COOLDOWN"); return false; }
    const bucket = priceBucketId(ctx.ask, this.p.bucketBps);
    if (ctx.now < (this.bucketUntil.get(bucket) ?? 0)) { this.reporter.intentBlocked("ACCUMULATION_BUCKET_LOCK"); return false; }
    if (ctx.usdtBalance <= this.p.minUsdtFloor) { this.reporter.intentBlocked("USDT_RESERVE_FLOOR"); return false; }

    const spend = Math.min(this.p.trancheUsdt, this.budget.maxSpend(ctx.usdtBalance, ctx.harvestRebuyReserve));
    if (spend <= 0) { this.reporter.intentBlocked("ACCUMULATION_BUDGET_EXCEEDED"); return false; }

    const qty = spend / ctx.ask;
    const accepted = await this.submit("buy", qty, ctx.ask, "acc-buy");
    // Lock the zone for a cooldown so we don't re-submit before the fill resolves.
    this.cooldownUntil = ctx.now + this.p.cooldownMs;
    this.bucketUntil.set(bucket, ctx.now + this.p.cooldownMs);
    void accepted;
    return true;
  }

  // Route an accumulation paper fill (called from PaperSoak for acc-* orders only).
  onPaperFill(side: "buy" | "sell", size: number, price: number, fillId: string, feeUsdt: number): void {
    if (side === "buy") {
      const c = this.tracker.onBuy(fillId, size, price, feeUsdt);
      this.budget.record(size * price);
      this.reporter.accBuy({
        cycleId: c.cycleId, qty: size, price, usdtSpent: size * price, fee: feeUsdt,
        recoveryTarget: c.targetRecoveryPrice, budgetRemaining: this.budget.snapshot().budgetRemaining,
      });
    } else {
      this.tracker.onRecoverySell(fillId, size, price, feeUsdt);
      this.reporter.accRecovery({ qty: size, price, fee: feeUsdt });
    }
  }

  metrics(): AccumulationMetrics {
    return this.tracker.metrics();
  }

  private async submit(side: "buy" | "sell", quantity: number, price: number, reason: string): Promise<boolean> {
    const req: ExecutionRequest = {
      requestId: randomUUID(),
      exchange: this.p.exchange,
      symbol: this.p.symbol,
      side,
      type: "LIMIT",
      quantity,
      price,
      tif: "GTC",
      source: "PAPER_SIM",
      reason,
      createdAt: Date.now(),
    };
    try {
      const result = await this.pipeline.submit(req);
      if (result.risk) this.reporter.decision({ side, quantity, price }, result.risk);
      return result.accepted;
    } catch (err) {
      this.log.warn({ err, side, reason }, "Accumulation submit threw");
      return false;
    }
  }
}
