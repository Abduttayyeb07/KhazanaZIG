import type { Exchange } from "./market.js";

// ── Drift classification: the operational truth language of Phase 2 ─────────────
//
// Reconciliation never returns a boolean. It classifies divergence between
// exchange truth and local state, and the class dictates the response:
//
//   MATCH          → no action
//   SOFT_DRIFT     → timing / websocket lag / eventual consistency → wait + retry
//   HARD_DRIFT     → missing fills / orders / balance mismatch → exchange overwrites local
//   CRITICAL_DRIFT → impossible state → HALT execution immediately
// ──────────────────────────────────────────────────────────────────────────────

export type DriftStatus = "MATCH" | "SOFT_DRIFT" | "HARD_DRIFT" | "CRITICAL_DRIFT";

export type DriftCategory =
  // SOFT
  | "TIMING_LAG"
  // HARD
  | "BALANCE_MISMATCH"
  | "MISSING_FILL"
  | "MISSING_ORDER"
  | "STALE_LOCAL_ORDER"
  // CRITICAL
  | "GHOST_ORDER"          // open order on exchange we have no record of
  | "DUPLICATE_FILL"       // same fillId applied more than once
  | "NEGATIVE_INVENTORY"
  | "IMPOSSIBLE_BALANCE";

export interface DriftIssue {
  category: DriftCategory;
  status: DriftStatus;
  detail: string;
  field?: string;
  expected?: string | number;
  actual?: string | number;
}

export interface ReconciliationResult {
  timestamp: number;
  exchange: Exchange;
  status: DriftStatus;
  issues: DriftIssue[];
  requiresExecutionHalt: boolean;
  repaired: boolean;
}

// Severity ordering — used to roll a set of issues up into a single status.
export const DRIFT_SEVERITY: Record<DriftStatus, number> = {
  MATCH: 0,
  SOFT_DRIFT: 1,
  HARD_DRIFT: 2,
  CRITICAL_DRIFT: 3,
};

// Maps each category to its inherent severity.
export const CATEGORY_STATUS: Record<DriftCategory, DriftStatus> = {
  TIMING_LAG: "SOFT_DRIFT",
  BALANCE_MISMATCH: "HARD_DRIFT",
  MISSING_FILL: "HARD_DRIFT",
  MISSING_ORDER: "HARD_DRIFT",
  STALE_LOCAL_ORDER: "HARD_DRIFT",
  GHOST_ORDER: "CRITICAL_DRIFT",
  DUPLICATE_FILL: "CRITICAL_DRIFT",
  NEGATIVE_INVENTORY: "CRITICAL_DRIFT",
  IMPOSSIBLE_BALANCE: "CRITICAL_DRIFT",
};

// Rolls a list of issues up into the worst status + halt decision.
export function classifyDrift(issues: DriftIssue[]): {
  status: DriftStatus;
  requiresExecutionHalt: boolean;
} {
  let worst: DriftStatus = "MATCH";
  for (const issue of issues) {
    if (DRIFT_SEVERITY[issue.status] > DRIFT_SEVERITY[worst]) {
      worst = issue.status;
    }
  }
  return { status: worst, requiresExecutionHalt: worst === "CRITICAL_DRIFT" };
}
