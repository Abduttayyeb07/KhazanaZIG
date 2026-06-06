import type { OrderSide } from "./exchange.js";
import type { Exchange } from "./market.js";

// ── Canonical execution request ────────────────────────────────────────────────
//
// The universal execution language. EVERYTHING that wants an order placed builds
// one of these — operator clicks, the paper harness, future strategy, future AI.
// The execution engine only ever consumes ExecutionRequest. It never decides what
// to trade; it safely executes validated intent.
// ──────────────────────────────────────────────────────────────────────────────

export type ExecutionSource = "PAPER_SIM" | "OPERATOR" | "STRATEGY";
export type TimeInForce = "GTC";

export interface ExecutionRequest {
  requestId: string;
  exchange: Exchange;
  symbol: string;
  side: OrderSide;
  type: "LIMIT"; // limit only to start — never market orders
  quantity: number;
  price: number;
  tif: TimeInForce;
  source: ExecutionSource;
  reason: string; // human-readable journal note: why this order exists
  createdAt: number;
}

// ── Order lifecycle ────────────────────────────────────────────────────────────
//
// Every order transitions through explicit states. No magic mutation.
//
//   CREATED → SUBMITTED → OPEN → PARTIALLY_FILLED → FILLED
//                              ↘ CANCEL_PENDING → CANCELLED
//   (SUBMITTED|CREATED) → REJECTED | FAILED
// ──────────────────────────────────────────────────────────────────────────────
export type ManagedOrderStatus =
  | "CREATED"
  | "SUBMITTED"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCEL_PENDING"
  | "CANCELLED"
  | "REJECTED"
  | "FAILED";

export interface ManagedOrder {
  clientOrderId: string;
  requestId: string;
  exchange: Exchange;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  filledQuantity: number;
  status: ManagedOrderStatus;
  source: ExecutionSource;
  reason: string;
  exchangeOrderId: string | null;
  // true if executed via the paper engine (simulation). Paper orders are NEVER
  // persisted to the durable store and are not subject to exchange-truth recovery.
  paper: boolean;
  createdAt: number;
  updatedAt: number;
}

// Events emitted by ANY execution adapter (paper or real) — identical shape so
// downstream (registry, treasury) behaves the same regardless of source.
export type OrderEventType =
  | "ORDER_OPENED"
  | "ORDER_PARTIALLY_FILLED"
  | "ORDER_FILLED"
  | "ORDER_CANCELLED"
  | "ORDER_REJECTED";

export interface OrderEvent {
  type: OrderEventType;
  clientOrderId: string;
  exchange: Exchange;
  exchangeOrderId?: string;
  // present on fill events:
  fillId?: string;
  fillPrice?: number;
  fillQuantity?: number;
  fee?: number;
  feeAsset?: string;
  reason?: string; // present on reject
  at: number;
}

// ── Legacy/simple execution result (kept for the existing skeleton) ────────────
export interface ExecutionOrder {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  size: number;
}

export type ExecutionResultStatus =
  | "submitted"
  | "rejected"
  | "duplicate"
  | "mode_blocked"
  | "paper_filled";

export interface ExecutionResult {
  clientOrderId: string;
  status: ExecutionResultStatus;
  exchangeOrderId?: string;
  rejectionReason?: string;
  timestamp: number;
}
