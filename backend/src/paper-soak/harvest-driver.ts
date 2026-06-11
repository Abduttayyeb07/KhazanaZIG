import { randomUUID } from "crypto";
import type { Logger } from "@zig/logger";
import type { Exchange, ExecutionRequest } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import type { VirtualAccount } from "./virtual-account.js";
import type { SoakReporter } from "./reporter.js";
import { priceBucketId } from "./cycle-tracker.js";
import type { AllowedActions } from "../zone-manager/zone-types.js";
import type { AccumulationEngine, AccTickContext } from "../accumulation/accumulation-engine.js";

// ── Soak driver (zone-aware, v3) ────────────────────────────────────────────────
//
// Originates intents in strict tick order — CLOSE obligations before OPENING new ones:
//   1. harvest rebuy   2. accumulation recovery sell   3. harvest sell   4. accumulation buy
// Only ONE action submits per tick (sequential, one order in flight).
//
// Closing-before-opening is NOT cosmetic. Selling first starved rebuys at price dips
// (the June-10 zero-rebuy bug): a dip is simultaneously rebuy-eligible AND a "fresh"
// sell bucket, so a sell-first/return tick sold into the very dip it should rebuy and
// never reached the rebuy step. Rebuy-first closes the cycle instead. We also refuse to
// open a new sell while any rebuy is eligible (don't sell where you're trying to buy).
//
// Sells are ZONE-gated (no avgCost anchor — fixes the "idle below cost" trap);
// harvest profit comes from the sell→rebuy spread. Zone C / above harvest at
// REDUCED aggression. Everything still flows through RiskEngine/Sizing.
// SAFETY: refuses to act outside PAPER_MODE.
// ──────────────────────────────────────────────────────────────────────────────

export interface HarvestParams {
  symbol: string;
  exchange: Exchange;
  minOrderZig: number;
  maxOrderActivePct: number;
  tickMs: number;
  sellCooldownMs: number;
  buyCooldownMs: number;
  sellBucketBps: number;
  buyBucketBps: number;
  rejectBackoffMs: number;
  maxUnrecoveredActivePct: number;
}

export interface ZoneView {
  allowed: AllowedActions;
  aggression: "FULL" | "REDUCED";
}

interface Backoff {
  until: number;
  price: number;
}

export class HarvestDriver {
  private sellCooldownUntil = 0;
  private readonly buyBucketUntil = new Map<number, number>();
  private sellBackoff: Backoff | null = null;
  private buyBackoff: Backoff | null = null;
  private timer: NodeJS.Timeout | null = null;
  private evaluating = false;

  constructor(
    private readonly stateEngine: StateEngine,
    private readonly pipeline: ExecutionPipeline,
    private readonly registry: OrderRegistry,
    private readonly account: VirtualAccount,
    private readonly reporter: SoakReporter,
    private readonly p: HarvestParams,
    private readonly zone: () => ZoneView,
    private readonly acc: AccumulationEngine | null,
    private readonly log: Logger
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.p.tickMs);
    this.log.info({ tickMs: this.p.tickMs, exchange: this.p.exchange }, "Harvest driver started");
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.evaluating) return;
    this.evaluating = true;
    try {
      const state = this.stateEngine.getState();
      if (state.mode !== "PAPER_MODE") return; // hard safety

      const m = state.market[this.p.exchange];
      if (!m || m.bestBid === null || m.bestAsk === null) return;
      const bid = m.bestBid;
      const ask = m.bestAsk;
      const now = Date.now();

      const pending = this.registry.openOrders().filter((o) => o.paper && o.exchange === this.p.exchange).length;
      if (pending > 0) return; // one order in flight

      this.maybeClearBackoff(bid, ask);
      const { allowed, aggression } = this.zone();

      const accCtx: AccTickContext | null = this.acc
        ? {
            bid,
            ask,
            spreadBps: m.spreadBps ?? Number.POSITIVE_INFINITY,
            liquidityUsdt: (m.askLiquidity ?? 0) * ask,
            regime: m.volatilityRegime,
            allowed,
            usdtBalance: this.account.usdtBalance,
            harvestRebuyReserve: this.account.harvestRebuyReserveUsdt,
            now,
          }
        : null;

      // ── 1. HARVEST REBUY — close open cycles whose target the dip reached ─
      const rebuyEligible = allowed.harvestRebuy ? this.account.openCyclesForRebuy(ask) : [];
      if (rebuyEligible.length > 0 && this.account.usdtBalance > 0) {
        const buyBucket = priceBucketId(ask, this.p.buyBucketBps);
        const buyBucketOk = now >= (this.buyBucketUntil.get(buyBucket) ?? 0);
        const buyBackoffOk = !this.buyBackoff || now >= this.buyBackoff.until;
        const desired = rebuyEligible.reduce((s, c) => s + c.unrecoveredQty, 0);
        if (buyBucketOk && buyBackoffOk && desired >= this.p.minOrderZig) {
          await this.submit("buy", desired, ask, now);
          return;
        }
      }

      // ── 2. ACCUMULATION RECOVERY SELL — close accumulation lots ──────────
      if (this.acc && accCtx) {
        if (await this.acc.attemptRecoverySell(accCtx)) return;
      }

      // ── 3. HARVEST SELL — open a new cycle (only after closes) ───────────
      // Never open a sell while a rebuy is eligible: the dip we'd sell into is the
      // very dip we should be buying back. Selling there is what starved rebuys.
      if (allowed.harvestSell) {
        if (rebuyEligible.length > 0) {
          this.reporter.intentBlocked("SELL_HELD_FOR_REBUY");
        } else {
          const active = this.account.activeZig;
          const cooldownOk = now >= this.sellCooldownUntil;
          const bucketOk = !this.account.sellBucketOccupied(bid, this.p.sellBucketBps);
          const backoffOk = !this.sellBackoff || now >= this.sellBackoff.until;
          if (cooldownOk && bucketOk && backoffOk && active >= this.p.minOrderZig) {
            if (this.account.unrecoveredZig >= this.account.startingActive * this.p.maxUnrecoveredActivePct) {
              this.reporter.intentBlocked("ACTIVE_DEPLOYMENT_CAP");
            } else {
              const mult = aggression === "REDUCED" ? 0.5 : 1;
              const desired = Math.max(active * this.p.maxOrderActivePct * mult, this.p.minOrderZig);
              await this.submit("sell", desired, bid, now);
              return;
            }
          }
        }
      }

      // ── 4. ACCUMULATION BUY — open a new accumulation lot (last) ─────────
      if (this.acc && accCtx) {
        await this.acc.attemptBuy(accCtx);
      }
    } catch (err) {
      this.log.warn({ err }, "Harvest tick failed");
    } finally {
      this.evaluating = false;
    }
  }

  private async submit(side: "buy" | "sell", quantity: number, price: number, now: number): Promise<void> {
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
      reason: side === "sell" ? "harvest-sell" : "harvest-rebuy",
      createdAt: Date.now(),
    };

    const result = await this.pipeline.submit(req);
    if (result.risk) this.reporter.decision({ side, quantity, price }, result.risk);

    if (result.accepted) {
      if (side === "sell") this.sellCooldownUntil = now + this.p.sellCooldownMs;
      else this.buyBucketUntil.set(priceBucketId(price, this.p.buyBucketBps), now + this.p.buyCooldownMs);
    } else {
      const backoff: Backoff = { until: now + this.p.rejectBackoffMs, price };
      if (side === "sell") this.sellBackoff = backoff;
      else this.buyBackoff = backoff;
    }
  }

  private maybeClearBackoff(bid: number, ask: number): void {
    if (this.sellBackoff && Math.abs(bid - this.sellBackoff.price) / this.sellBackoff.price > this.p.sellBucketBps / 10_000) {
      this.sellBackoff = null;
    }
    if (this.buyBackoff && Math.abs(ask - this.buyBackoff.price) / this.buyBackoff.price > this.p.buyBucketBps / 10_000) {
      this.buyBackoff = null;
    }
  }
}
