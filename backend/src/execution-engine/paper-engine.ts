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

export class PaperEngine implements ExecutionAdapter {
  private readonly onEvent: EventSink;
  private readonly price: PriceProvider;
  private readonly log: Logger;
  private readonly resting = new Map<string, ManagedOrder>();

  constructor(onEvent: EventSink, price: PriceProvider, log: Logger) {
    this.onEvent = onEvent;
    this.price = price;
    this.log = log.child({ module: "paper-engine" });
  }

  async placeOrder(order: ManagedOrder): Promise<PlaceAck> {
    const exchangeOrderId = `PAPER-${order.clientOrderId}`;
    // Ack + OPEN, exactly like a real exchange accepting a resting limit order.
    this.onEvent(this.openEvent(order, exchangeOrderId));

    if (this.isMarketable(order)) {
      this.fill(order, order.quantity - order.filledQuantity, exchangeOrderId);
    } else {
      this.resting.set(order.clientOrderId, order);
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
      if (this.isMarketable(order)) {
        this.resting.delete(order.clientOrderId);
        this.fill(order, order.quantity - order.filledQuantity, order.exchangeOrderId ?? `PAPER-${order.clientOrderId}`);
      }
    }
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
      fillPrice: order.price,
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
