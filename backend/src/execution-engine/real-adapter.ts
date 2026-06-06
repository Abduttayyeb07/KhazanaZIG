import type { Logger } from "@zig/logger";
import type { ManagedOrder } from "@zig/shared-types";
import type { ExecutionAdapter, EventSink, PlaceAck } from "./adapter.js";
import type { BybitRestClient } from "../exchange/bybit/rest.js";
import type { MexcRestClient } from "../exchange/mexc/rest.js";

// ── Real execution adapters ────────────────────────────────────────────────────
//
// Place/cancel real LIMIT orders via authenticated REST. On accept they emit
// ORDER_OPENED; on reject ORDER_REJECTED. FILLS DO NOT come from here — real fills
// are detected by the execution-sync loop (OrderReconciler against exchange truth),
// exactly like a real exchange delivers fills asynchronously. Same OrderEvents as
// the paper engine, so downstream is identical.
//
// These only ever run in NORMAL/DEFENSIVE mode — the pipeline's mode gate ensures
// READ_ONLY/PAPER never reach a real adapter.
// ──────────────────────────────────────────────────────────────────────────────

abstract class BaseRealAdapter implements ExecutionAdapter {
  protected readonly onEvent: EventSink;
  protected readonly log: Logger;

  constructor(onEvent: EventSink, log: Logger, name: string) {
    this.onEvent = onEvent;
    this.log = log.child({ module: name });
  }

  protected abstract place(order: ManagedOrder): Promise<{ orderId: string }>;
  protected abstract cancel(order: ManagedOrder): Promise<void>;

  async placeOrder(order: ManagedOrder): Promise<PlaceAck> {
    try {
      const { orderId } = await this.place(order);
      this.log.warn(
        { clientOrderId: order.clientOrderId, exchangeOrderId: orderId, side: order.side, qty: order.quantity, price: order.price },
        "[REAL] order placed on exchange"
      );
      this.onEvent({ type: "ORDER_OPENED", clientOrderId: order.clientOrderId, exchange: order.exchange, exchangeOrderId: orderId, at: Date.now() });
      return { accepted: true, exchangeOrderId: orderId };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "place failed";
      this.onEvent({ type: "ORDER_REJECTED", clientOrderId: order.clientOrderId, exchange: order.exchange, reason, at: Date.now() });
      return { accepted: false, reason };
    }
  }

  async cancelOrder(order: ManagedOrder): Promise<void> {
    try {
      await this.cancel(order);
      this.onEvent({ type: "ORDER_CANCELLED", clientOrderId: order.clientOrderId, exchange: order.exchange, exchangeOrderId: order.exchangeOrderId ?? undefined, at: Date.now() });
    } catch (err) {
      this.log.warn({ err, clientOrderId: order.clientOrderId }, "[REAL] cancel failed (order may have filled)");
    }
  }
}

export class BybitExecutionAdapter extends BaseRealAdapter {
  private readonly rest: BybitRestClient;
  constructor(rest: BybitRestClient, onEvent: EventSink, log: Logger) {
    super(onEvent, log, "bybit-exec-adapter");
    this.rest = rest;
  }
  protected place(o: ManagedOrder) {
    return this.rest.placeLimitOrder({ symbol: o.symbol, side: o.side, price: o.price, qty: o.quantity, clientOrderId: o.clientOrderId });
  }
  protected cancel(o: ManagedOrder) {
    return this.rest.cancelOrder({ symbol: o.symbol, clientOrderId: o.clientOrderId });
  }
}

export class MexcExecutionAdapter extends BaseRealAdapter {
  private readonly rest: MexcRestClient;
  constructor(rest: MexcRestClient, onEvent: EventSink, log: Logger) {
    super(onEvent, log, "mexc-exec-adapter");
    this.rest = rest;
  }
  protected place(o: ManagedOrder) {
    return this.rest.placeLimitOrder({ symbol: o.symbol, side: o.side, price: o.price, qty: o.quantity, clientOrderId: o.clientOrderId });
  }
  protected cancel(o: ManagedOrder) {
    return this.rest.cancelOrder({ symbol: o.symbol, clientOrderId: o.clientOrderId });
  }
}

// Routes a request to the right venue's adapter by order.exchange.
export class RealExecutionRouter implements ExecutionAdapter {
  private readonly bybit: BybitExecutionAdapter | null;
  private readonly mexc: MexcExecutionAdapter | null;

  constructor(bybit: BybitExecutionAdapter | null, mexc: MexcExecutionAdapter | null) {
    this.bybit = bybit;
    this.mexc = mexc;
  }

  private adapter(order: ManagedOrder): ExecutionAdapter | null {
    return order.exchange === "bybit" ? this.bybit : this.mexc;
  }

  async placeOrder(order: ManagedOrder): Promise<PlaceAck> {
    const a = this.adapter(order);
    if (!a) return { accepted: false, reason: `No authenticated adapter for ${order.exchange}` };
    return a.placeOrder(order);
  }

  async cancelOrder(order: ManagedOrder): Promise<void> {
    await this.adapter(order)?.cancelOrder(order);
  }
}
