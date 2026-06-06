import type { Logger } from "@zig/logger";
import type { Exchange, ExchangeFill, ManagedOrderStatus } from "@zig/shared-types";
import type { AuthenticatedExchangeClient } from "../session/session-manager.js";
import type { BybitRestClient } from "../exchange/bybit/rest.js";
import type { MexcRestClient } from "../exchange/mexc/rest.js";
import type { OrderRegistry } from "./registry.js";

export type RealFillSink = (fill: ExchangeFill) => void;

// ── Order Reconciler (crash recovery) ──────────────────────────────────────────
//
// On restart we reload our managed orders from the store — but we NEVER trust that
// alone. This rebuilds each live order's true state from EXCHANGE TRUTH:
//
//   still open on exchange      → OPEN / PARTIALLY_FILLED (sync filled qty)
//   gone + fills cover quantity → FILLED  (emit the real fills to treasury)
//   gone + partial/no fills     → CANCELLED (emit any real fills found)
//
// A timed-out submit that actually landed is resolved here — the order shows up in
// exchange truth and is adopted, instead of being silently lost or double-sent.
// ──────────────────────────────────────────────────────────────────────────────

export class OrderReconciler {
  private readonly registry: OrderRegistry;
  private readonly symbol: string;
  private readonly log: Logger;

  constructor(registry: OrderRegistry, symbol: string, log: Logger) {
    this.registry = registry;
    this.symbol = symbol;
    this.log = log.child({ module: "order-reconciler" });
  }

  async reconcile(client: AuthenticatedExchangeClient, onRealFill: RealFillSink): Promise<void> {
    const active = this.registry.openOrders().filter((o) => !o.paper);
    if (active.length === 0) return;

    this.log.info({ active: active.length }, "Reconciling live orders against exchange truth");

    // Group by exchange so we fetch truth once per venue.
    for (const exchange of ["bybit", "mexc"] as Exchange[]) {
      const orders = active.filter((o) => o.exchange === exchange);
      if (orders.length === 0) continue;

      const rest = exchange === "bybit" ? client.bybit : client.mexc;
      if (!rest) {
        this.log.warn({ exchange }, "No authenticated client — cannot recover orders for this exchange");
        continue;
      }

      const [openOrders, fills] = await Promise.all([
        rest.getOpenOrders(this.symbol),
        rest.getRecentFills(this.symbol),
      ]);
      const openByClientId = new Map(openOrders.map((o) => [o.clientOrderId, o]));

      for (const order of orders) {
        const live = openByClientId.get(order.clientOrderId);

        // Emit this order's real fills to treasury (deduped downstream by fillId).
        const orderFills = fills.filter((f) => f.clientOrderId === order.clientOrderId);
        for (const f of orderFills) onRealFill(f);
        const filledFromExchange = orderFills.reduce((sum, f) => sum + f.size, 0);

        if (live) {
          // Still open — adopt the exchange's filled quantity.
          const filled = Math.max(live.filledSize, filledFromExchange);
          const status: ManagedOrderStatus = filled > 0 ? "PARTIALLY_FILLED" : "OPEN";
          this.registry.setReconciled(order.clientOrderId, filled, status, live.orderId);
        } else if (filledFromExchange >= order.quantity - 1e-9) {
          // Gone + fully filled.
          this.registry.setReconciled(order.clientOrderId, filledFromExchange, "FILLED");
        } else if (order.status === "SUBMITTED") {
          // DELAYED-WS / in-flight guard: a just-submitted order may not yet be
          // visible on the exchange (REST lag). Do NOT cancel it — leave it
          // SUBMITTED and resolve on a later cycle. Record any partial fills found.
          if (filledFromExchange > 0) {
            this.registry.setReconciled(order.clientOrderId, filledFromExchange, "PARTIALLY_FILLED");
          }
          this.log.info({ clientOrderId: order.clientOrderId }, "Order not yet visible on exchange — awaiting (no cancel)");
        } else {
          // Was OPEN/PARTIALLY_FILLED and is now gone with incomplete fills → cancelled.
          this.registry.setReconciled(order.clientOrderId, filledFromExchange, "CANCELLED");
        }
      }
    }
  }
}

export type { BybitRestClient, MexcRestClient };
