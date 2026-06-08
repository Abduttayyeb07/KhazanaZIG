import { randomUUID } from "crypto";
import type { Logger } from "@zig/logger";
import type { Exchange, ExecutionRequest } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import type { VirtualAccount } from "./virtual-account.js";
import type { SoakReporter } from "./reporter.js";
import { priceBucketId } from "./cycle-tracker.js";

// ── Cost-band harvest driver (v2 — disciplined) ─────────────────────────────────
//
// Originates intents and feeds them through the real Risk + Sizing engines.
// v2 discipline (driver-side gates, before the pipeline):
//   • cooldown      — min time between same-side fills (no machine-gun)
//   • price bucket  — don't re-trade the same tiny price zone
//   • deployment cap— pause sells once too much active inventory is sold-but-unrebought
//   • reject backoff— stop re-emitting an intent that keeps getting rejected
//   • cycle-bound buys — only buy to recover an OPEN sell cycle whose target price hit
//
// Market-quality gates (CHAOTIC, stale book, spread, liquidity, min order, daily
// caps, reconciliation) remain the RiskEngine's job — not duplicated here.
// SAFETY: refuses to act unless the engine is in PAPER_MODE.
// ────────────────────────────────────────────────────────────────────────────────

export interface HarvestParams {
  symbol: string;
  exchange: Exchange;
  minSellProfitBps: number;
  minOrderZig: number;
  maxOrderActivePct: number;
  tickMs: number;
  // v2
  sellCooldownMs: number;
  buyCooldownMs: number;
  sellBucketBps: number;
  buyBucketBps: number;
  rejectBackoffMs: number;
  maxUnrecoveredActivePct: number;
}

interface Backoff {
  until: number;
  price: number;
}

export class HarvestDriver {
  private sellCooldownUntil = 0;                       // global time floor between sells
  private readonly buyBucketUntil = new Map<number, number>(); // per price-bucket buy lock (combines buy cooldown + buy bucket)
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

  // Public for tests; the interval calls this each tick.
  async tick(): Promise<void> {
    if (this.evaluating) return;
    this.evaluating = true;
    try {
      const state = this.stateEngine.getState();
      if (state.mode !== "PAPER_MODE") return; // hard safety: never auto-trade outside paper

      const m = state.market[this.p.exchange];
      if (!m || m.bestBid === null || m.bestAsk === null) return;
      const bid = m.bestBid;
      const ask = m.bestAsk;
      const now = Date.now();

      // One order in flight at a time — wait for the current paper order to resolve.
      const pending = this.registry.openOrders().filter((o) => o.paper && o.exchange === this.p.exchange).length;
      if (pending > 0) return;

      // A meaningful price move clears a stale reject-backoff.
      this.maybeClearBackoff(bid, ask);

      // ── SELL evaluation ──────────────────────────────────────────────────
      const avgCost = this.account.avgCost;
      const active = this.account.activeZig;
      const sellThreshold = avgCost > 0 ? avgCost * (1 + this.p.minSellProfitBps / 10_000) : Infinity;

      const sellProfitable = avgCost > 0 && bid >= sellThreshold;
      const sellCooldownOk = now >= this.sellCooldownUntil;
      // Bucket occupancy: don't re-sell a zone that still has an OPEN cycle; frees
      // when that cycle completes (so a post-rebuy profitable sell here is allowed).
      const sellBucketOk = !this.account.sellBucketOccupied(bid, this.p.sellBucketBps);
      const sellBackoffOk = !this.sellBackoff || now >= this.sellBackoff.until;
      const sellSizeOk = active >= this.p.minOrderZig;

      if (sellProfitable && sellCooldownOk && sellBucketOk && sellBackoffOk && sellSizeOk) {
        const maxUnrecovered = this.account.startingActive * this.p.maxUnrecoveredActivePct;
        if (this.account.unrecoveredZig >= maxUnrecovered) {
          this.reporter.intentBlocked("ACTIVE_DEPLOYMENT_CAP");
        } else {
          const desired = Math.max(active * this.p.maxOrderActivePct, this.p.minOrderZig);
          await this.submit("sell", desired, bid, now);
          return;
        }
      }

      // ── BUY evaluation (cycle-bound only) ────────────────────────────────
      const usdt = this.account.usdtBalance;
      const eligible = this.account.openCyclesForRebuy(ask);
      if (eligible.length > 0 && usdt > 0) {
        // Per-bucket buy lock = buy cooldown + buy bucket in one: a recovered zone is
        // locked for BUY_COOLDOWN, but a DIFFERENT zone (distinct cycle) is free to
        // recover immediately. Total buy volume stays bounded by the deployment cap.
        const buyBucket = priceBucketId(ask, this.p.buyBucketBps);
        const buyBucketOk = now >= (this.buyBucketUntil.get(buyBucket) ?? 0);
        const buyBackoffOk = !this.buyBackoff || now >= this.buyBackoff.until;
        const desired = eligible.reduce((s, c) => s + c.unrecoveredQty, 0); // never more than what's owed
        if (buyBucketOk && buyBackoffOk && desired >= this.p.minOrderZig) {
          await this.submit("buy", desired, ask, now);
        }
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
      if (side === "sell") {
        this.sellCooldownUntil = now + this.p.sellCooldownMs;
      } else {
        this.buyBucketUntil.set(priceBucketId(price, this.p.buyBucketBps), now + this.p.buyCooldownMs);
      }
    } else {
      // Repeated-reject suppression: pause this side until backoff expires or price moves.
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
