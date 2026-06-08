import type { Logger } from "@zig/logger";
import type { Exchange, ManagedOrder, OrderEvent } from "@zig/shared-types";
import type { ExecutionAdapter, EventSink, PlaceAck } from "./adapter.js";

export interface TopOfBook {
  bestBid: number;
  bestAsk: number;
}
export type PriceProvider = (exchange: Exchange) => TopOfBook | null;

// ── Paper execution engine ─────────────────────────────────────────────────────
//
// Simulates an exchange WITHOUT touching real markets. Emits the EXACT same
// OrderEvents as a real adapter, so the registry/treasury behave identically.
//
// Fill model (limit orders):
//   SELL @ P fills when best bid >= P   (a buyer will lift your ask)
//   BUY  @ P fills when best ask <= P   (a seller will hit your bid)
// Marketable-on-arrival orders fill immediately; otherwise they rest and are
// filled on tick() when the market crosses the limit. Cancels resting orders.
// ──────────────────────────────────────────────────────────────────────────────

export interface PaperRealism {
  slippageBps?: number;       // adverse price move on fill (0 = perfect)
  fillProbability?: number;   // chance a marketable order actually fills this tick (1 = always)
  rng?: () => number;         // injectable for deterministic tests; default Math.random
}

export class PaperEngine implements ExecutionAdapter {
  private readonly onEvent: EventSink;
  private readonly price: PriceProvider;
  private readonly log: Logger;
  private readonly resting = new Map<string, ManagedOrder>();
  private readonly slippageBps: number;
  private readonly fillProbability: number;
  private readonly rng: () => number;

  constructor(onEvent: EventSink, price: PriceProvider, log: Logger, realism: PaperRealism = {}) {
    this.onEvent = onEvent;
    this.price = price;
    this.log = log.child({ module: "paper-engine" });
    this.slippageBps = realism.slippageBps ?? 0;
    this.fillProbability = realism.fillProbability ?? 1;
    this.rng = realism.rng ?? Math.random;
  }

  async placeOrder(order: ManagedOrder): Promise<PlaceAck> {
    const exchangeOrderId = `PAPER-${order.clientOrderId}`;
    // Ack + OPEN, exactly like a real exchange accepting a resting limit order.
    this.onEvent(this.openEvent(order, exchangeOrderId));

    if (this.isMarketable(order) && this.fillsThisTick()) {
      this.fill(order, order.quantity - order.filledQuantity, exchangeOrderId);
    } else {
      this.resting.set(order.clientOrderId, order); // not marketable, or fill probability missed → rest & retry
    }
    return { accepted: true, exchangeOrderId };
  }

  async cancelOrder(order: ManagedOrder): Promise<void> {
    if (this.resting.delete(order.clientOrderId)) {
      this.onEvent({
        type: "ORDER_CANCELLED",
        clientOrderId: order.clientOrderId,
        exchange: order.exchange,
        exchangeOrderId: order.exchangeOrderId ?? `PAPER-${order.clientOrderId}`,
        at: Date.now(),
      });
    }
  }

  // Called on each market update — fills resting orders whose limit has crossed.
  tick(): void {
    for (const order of [...this.resting.values()]) {
      if (this.isMarketable(order) && this.fillsThisTick()) {
        this.resting.delete(order.clientOrderId);
        this.fill(order, order.quantity - order.filledQuantity, order.exchangeOrderId ?? `PAPER-${order.clientOrderId}`);
      }
    }
  }

  // Probabilistic fill — a marketable order only fills `fillProbability` of the time.
  private fillsThisTick(): boolean {
    return this.fillProbability >= 1 || this.rng() < this.fillProbability;
  }

  // Apply adverse slippage to the execution price (worse for us on both sides).
  private slip(side: ManagedOrder["side"], price: number): number {
    if (this.slippageBps <= 0) return price;
    return side === "sell" ? price * (1 - this.slippageBps / 10_000) : price * (1 + this.slippageBps / 10_000);
  }

  // Test hook for the chaos harness: force a partial fill of `qty`.
  forcePartial(order: ManagedOrder, qty: number): void {
    this.fill(order, qty, order.exchangeOrderId ?? `PAPER-${order.clientOrderId}`, true);
  }

  private isMarketable(order: ManagedOrder): boolean {
    const top = this.price(order.exchange);
    if (!top) return false;
    return order.side === "sell" ? top.bestBid >= order.price : top.bestAsk <= order.price;
  }

  private fill(order: ManagedOrder, qty: number, exchangeOrderId: string, partial = false): void {
    if (qty <= 0) return;
    const remaining = order.quantity - order.filledQuantity;
    const fillQty = partial ? Math.min(qty, remaining) : remaining;
    const fullyFills = fillQty >= remaining - 1e-12;

    const ev: OrderEvent = {
      type: fullyFills ? "ORDER_FILLED" : "ORDER_PARTIALLY_FILLED",
      clientOrderId: order.clientOrderId,
      exchange: order.exchange,
      exchangeOrderId,
      fillId: `PAPER-FILL-${order.clientOrderId}-${Date.now()}`,
      fillPrice: this.slip(order.side, order.price),
      fillQuantity: fillQty,
      fee: 0,
      feeAsset: "USDT",
      at: Date.now(),
    };
    this.log.info(
      { clientOrderId: order.clientOrderId, side: order.side, price: order.price, fillQty, fullyFills },
      "[PAPER] simulated fill"
    );
    this.onEvent(ev);
  }

  private openEvent(order: ManagedOrder, exchangeOrderId: string): OrderEvent {
    return {
      type: "ORDER_OPENED",
      clientOrderId: order.clientOrderId,
      exchange: order.exchange,
      exchangeOrderId,
      at: Date.now(),
    };
  }
}
