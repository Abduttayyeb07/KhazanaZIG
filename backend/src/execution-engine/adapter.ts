import type { ManagedOrder, OrderEvent } from "@zig/shared-types";

// ── Execution adapter contract ─────────────────────────────────────────────────
//
// Both the paper engine and the real Bybit/MEXC adapters implement this. placeOrder
// returns an immediate ack/reject (like an exchange REST response); subsequent
// fills/cancels arrive asynchronously as OrderEvents via the `onEvent` callback
// supplied at construction — mirroring how real exchanges deliver fills over WS.
// ──────────────────────────────────────────────────────────────────────────────

export interface PlaceAck {
  accepted: boolean;
  exchangeOrderId?: string;
  reason?: string;
}

export interface ExecutionAdapter {
  placeOrder(order: ManagedOrder): Promise<PlaceAck>;
  cancelOrder(order: ManagedOrder): Promise<void>;
}

export type EventSink = (ev: OrderEvent) => void;
