import type { ManagedOrderStatus } from "@zig/shared-types";

// ── Order state machine ────────────────────────────────────────────────────────
//
// Explicit, validated transitions. No magic mutation — a transition that isn't
// in this table is a bug and is rejected. This is the single source of truth for
// "what can happen next" to an order.
// ──────────────────────────────────────────────────────────────────────────────

const TRANSITIONS: Record<ManagedOrderStatus, ManagedOrderStatus[]> = {
  CREATED: ["SUBMITTED", "REJECTED", "FAILED"],
  SUBMITTED: ["OPEN", "PARTIALLY_FILLED", "FILLED", "REJECTED", "FAILED"],
  OPEN: ["PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELLED"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELLED"],
  CANCEL_PENDING: ["CANCELLED", "FILLED", "PARTIALLY_FILLED"], // order may fill before cancel lands
  // terminal states
  FILLED: [],
  CANCELLED: [],
  REJECTED: [],
  FAILED: [],
};

export function canTransition(from: ManagedOrderStatus, to: ManagedOrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ManagedOrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
