import { EventEmitter } from "events";
import type { Logger } from "@zig/logger";
import type { ExecutionRequest, ManagedOrder, ManagedOrderStatus, OrderEvent } from "@zig/shared-types";
import { canTransition, isTerminal } from "./lifecycle.js";
import type { OrderStore } from "./order-store.js";

// ── Order Registry ─────────────────────────────────────────────────────────────
//
// In-memory record of every order and its lifecycle. The pipeline registers
// orders here; adapter events (paper or real) drive transitions. All state
// changes go through the validated state machine — no ad-hoc mutation.
//
// On restart, this rebuilds from EXCHANGE TRUTH (Phase 4 Week 2), never trusting
// local memory alone. For now it's the live in-memory tracker.
//
// Emits "fill" (with details) so the treasury ledger can append, and "event"
// for the execution journal / dashboard.
// ──────────────────────────────────────────────────────────────────────────────

export class OrderRegistry extends EventEmitter {
  private readonly orders = new Map<string, ManagedOrder>();
  private readonly appliedFills = new Set<string>(); // fillIds already counted (dedup)
  private readonly log: Logger;
  private readonly store: OrderStore | null;

  constructor(log: Logger, store: OrderStore | null = null) {
    super();
    this.log = log.child({ module: "order-registry" });
    this.store = store;
  }

  // Durable, fire-and-forget persistence (OrderStore skips paper orders).
  private persist(order: ManagedOrder): void {
    void this.store?.save(order).catch((err) => this.log.warn({ err }, "persist failed"));
  }

  register(req: ExecutionRequest, clientOrderId: string, paper: boolean): ManagedOrder {
    const now = Date.now();
    const order: ManagedOrder = {
      clientOrderId,
      requestId: req.requestId,
      exchange: req.exchange,
      symbol: req.symbol,
      side: req.side,
      price: req.price,
      quantity: req.quantity,
      filledQuantity: 0,
      status: "CREATED",
      source: req.source,
      reason: req.reason,
      exchangeOrderId: null,
      paper,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(clientOrderId, order);
    this.persist(order);
    return order;
  }

  // Load persisted (active, real) orders on boot — rebuild the registry so
  // idempotency and recovery survive a restart. Does not re-emit events.
  hydrate(orders: ManagedOrder[]): void {
    for (const o of orders) this.orders.set(o.clientOrderId, o);
    this.log.info({ count: orders.length }, "Registry hydrated from store");
  }

  get(clientOrderId: string): ManagedOrder | undefined {
    return this.orders.get(clientOrderId);
  }

  has(clientOrderId: string): boolean {
    return this.orders.has(clientOrderId);
  }

  openOrders(): ManagedOrder[] {
    return [...this.orders.values()].filter((o) => !isTerminal(o.status));
  }

  all(): ManagedOrder[] {
    return [...this.orders.values()];
  }

  // Validated transition. Returns false (and logs) on an illegal transition
  // rather than corrupting state.
  transition(clientOrderId: string, to: ManagedOrderStatus, exchangeOrderId?: string): boolean {
    const order = this.orders.get(clientOrderId);
    if (!order) {
      this.log.warn({ clientOrderId, to }, "Transition on unknown order");
      return false;
    }
    if (order.status === to) return true;
    if (!canTransition(order.status, to)) {
      this.log.warn({ clientOrderId, from: order.status, to }, "Illegal order transition rejected");
      return false;
    }
    order.status = to;
    if (exchangeOrderId) order.exchangeOrderId = exchangeOrderId;
    order.updatedAt = Date.now();
    this.persist(order);
    return true;
  }

  // Authoritative re-sync from exchange truth (crash recovery). Sets the absolute
  // filled quantity and status directly rather than replaying events — re-applying
  // events would double-count. Exchange truth wins.
  setReconciled(clientOrderId: string, filledQuantity: number, status: ManagedOrderStatus, exchangeOrderId?: string): void {
    const order = this.orders.get(clientOrderId);
    if (!order) return;
    order.filledQuantity = filledQuantity;
    if (exchangeOrderId) order.exchangeOrderId = exchangeOrderId;
    // status may legitimately jump (e.g. SUBMITTED→FILLED) after a downtime;
    // recovery is allowed to set it directly.
    order.status = status;
    order.updatedAt = Date.now();
    this.persist(order);
    this.log.info({ clientOrderId, filledQuantity, status }, "Order reconciled from exchange truth");
    this.emit("event", { type: "ORDER_OPENED", clientOrderId, exchange: order.exchange, at: Date.now() } as OrderEvent, order);
  }

  // Apply an adapter event (paper or real) to the order it concerns.
  applyEvent(ev: OrderEvent): void {
    const order = this.orders.get(ev.clientOrderId);
    if (!order) {
      this.log.warn({ clientOrderId: ev.clientOrderId, type: ev.type }, "Event for unknown order");
      return;
    }

    switch (ev.type) {
      case "ORDER_OPENED":
        this.transition(order.clientOrderId, "OPEN", ev.exchangeOrderId);
        break;

      case "ORDER_PARTIALLY_FILLED":
      case "ORDER_FILLED": {
        // Dedup by fillId — a duplicate fill event (re-delivery, replay) must NOT
        // double-count the filled quantity. Same guarantee treasury has downstream.
        if (ev.fillId && this.appliedFills.has(ev.fillId)) {
          this.log.debug({ fillId: ev.fillId }, "Duplicate fill event ignored");
          return;
        }
        if (ev.fillId) this.appliedFills.add(ev.fillId);

        const qty = ev.fillQuantity ?? 0;
        order.filledQuantity = Math.min(order.quantity, order.filledQuantity + qty);
        const fullyFilled = order.filledQuantity >= order.quantity - 1e-12;
        this.transition(order.clientOrderId, fullyFilled ? "FILLED" : "PARTIALLY_FILLED", ev.exchangeOrderId);
        // Surface the fill so treasury can append it (append-only, dedup by fillId)
        this.emit("fill", ev, order);
        break;
      }

      case "ORDER_CANCELLED":
        this.transition(order.clientOrderId, "CANCELLED", ev.exchangeOrderId);
        break;

      case "ORDER_REJECTED":
        this.transition(order.clientOrderId, "REJECTED", ev.exchangeOrderId);
        break;
    }

    this.log.info(
      { clientOrderId: order.clientOrderId, type: ev.type, status: order.status, filled: order.filledQuantity },
      "Order event applied"
    );
    this.emit("event", ev, order);
  }
}
