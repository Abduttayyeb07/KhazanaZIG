import { randomUUID } from "crypto";
import type { Logger } from "@zig/logger";
import type { Exchange, ExecutionRequest } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import type { VirtualAccount } from "./virtual-account.js";
import type { SoakReporter } from "./reporter.js";

// ── Cost-band harvest driver ────────────────────────────────────────────────────
//
// The "brain" that ORIGINATES intents (the system otherwise only validates them).
// Simple, explainable treasury logic:
//   SELL a slice of active inventory when the bid is MIN_SELL_PROFIT_BPS above
//        weighted-average cost.
//   REBUY when the ask falls MIN_REBUY_DISTANCE_BPS below the last sell price.
// Every intent still flows through the real Risk + Sizing engines (which may
// REDUCE or REJECT it). One order in flight at a time — sequential, no spam.
//
// SAFETY: refuses to act unless the engine is in PAPER_MODE.
// ────────────────────────────────────────────────────────────────────────────────

export interface HarvestParams {
  symbol: string;
  exchange: Exchange;
  minSellProfitBps: number;
  minRebuyDistanceBps: number;
  minOrderZig: number;
  maxOrderActivePct: number;
  buySlicePct: number;
  tickMs: number;
}

export class HarvestDriver {
  private lastSellPrice: number | null = null;
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

  private async tick(): Promise<void> {
    if (this.evaluating) return;
    this.evaluating = true;
    try {
      const state = this.stateEngine.getState();
      if (state.mode !== "PAPER_MODE") return; // hard safety: never auto-trade outside paper

      const m = state.market[this.p.exchange];
      if (!m || m.bestBid === null || m.bestAsk === null) return;

      // One order in flight at a time — wait for the current paper order to resolve.
      const pending = this.registry.openOrders().filter((o) => o.paper && o.exchange === this.p.exchange).length;
      if (pending > 0) return;

      const avgCost = this.account.avgCost;
      const active = this.account.activeZig;
      const usdt = this.account.usdtBalance;

      const sellThreshold = avgCost > 0 ? avgCost * (1 + this.p.minSellProfitBps / 10_000) : Infinity;
      const canSell = avgCost > 0 && active >= this.p.minOrderZig && m.bestBid >= sellThreshold;

      const rebuyThreshold = this.lastSellPrice !== null ? this.lastSellPrice * (1 - this.p.minRebuyDistanceBps / 10_000) : -Infinity;
      const buyDesiredZig = m.bestAsk > 0 ? (usdt * this.p.buySlicePct) / m.bestAsk : 0;
      const canBuy = this.lastSellPrice !== null && usdt > 0 && buyDesiredZig >= this.p.minOrderZig && m.bestAsk <= rebuyThreshold;

      if (canSell) {
        const desired = Math.max(active * this.p.maxOrderActivePct, this.p.minOrderZig);
        await this.submit("sell", desired, m.bestBid);
      } else if (canBuy) {
        await this.submit("buy", buyDesiredZig, m.bestAsk);
      }
    } catch (err) {
      this.log.warn({ err }, "Harvest tick failed");
    } finally {
      this.evaluating = false;
    }
  }

  private async submit(side: "buy" | "sell", quantity: number, price: number): Promise<void> {
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
      if (side === "sell") this.lastSellPrice = price;
      else this.lastSellPrice = null; // rebuy completes the cycle
    }
  }
}
