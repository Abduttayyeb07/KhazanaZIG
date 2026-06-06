import type {
  Exchange,
  ExchangeBalance,
  ExchangeOrder,
  ExchangeFill,
  DriftIssue,
} from "@zig/shared-types";

// ── Pure drift detection ───────────────────────────────────────────────────────
//
// Compares exchange truth against the local view and emits classified DriftIssues.
// PURE: no I/O, no side effects, no dispatch. Deterministic and testable.
//
// Severity mapping (see shared-types CATEGORY_STATUS):
//   GHOST_ORDER, DUPLICATE_FILL, NEGATIVE_INVENTORY, IMPOSSIBLE_BALANCE → CRITICAL
//   BALANCE_MISMATCH, MISSING_FILL, MISSING_ORDER, STALE_LOCAL_ORDER    → HARD
//   TIMING_LAG                                                          → SOFT
// ──────────────────────────────────────────────────────────────────────────────

// Balances below this absolute delta are treated as equal (dust / rounding).
const BALANCE_EPSILON = 1e-8;

export interface ExchangeSnapshot {
  balances: ExchangeBalance[];
  openOrders: ExchangeOrder[];
  fills: ExchangeFill[];
}

export interface LocalView {
  balances: ExchangeBalance[];
  openOrders: ExchangeOrder[];
  fills: ExchangeFill[];
}

export function detectDrift(
  exchange: Exchange,
  snapshot: ExchangeSnapshot,
  local: LocalView
): DriftIssue[] {
  const issues: DriftIssue[] = [];

  detectImpossibleBalances(snapshot.balances, issues);
  detectBalanceMismatches(snapshot.balances, local.balances, issues);
  detectGhostOrders(snapshot.openOrders, local.openOrders, issues);
  detectStaleLocalOrders(snapshot.openOrders, local.openOrders, issues);
  detectMissingFills(snapshot.fills, local.fills, issues);
  detectDuplicateLocalFills(local.fills, issues);

  return issues;
}

// CRITICAL: exchange itself reports an impossible balance.
function detectImpossibleBalances(balances: ExchangeBalance[], issues: DriftIssue[]): void {
  for (const b of balances) {
    if (b.total < 0 || b.available < 0 || b.locked < 0) {
      issues.push({
        category: b.total < 0 ? "NEGATIVE_INVENTORY" : "IMPOSSIBLE_BALANCE",
        status: "CRITICAL_DRIFT",
        detail: `${b.asset} reported negative by exchange`,
        field: b.asset,
        actual: b.total,
      });
    }
  }
}

// HARD: local balance disagrees with exchange truth beyond epsilon.
function detectBalanceMismatches(
  exchange: ExchangeBalance[],
  local: ExchangeBalance[],
  issues: DriftIssue[]
): void {
  const localByAsset = new Map(local.map((b) => [b.asset, b]));
  for (const ex of exchange) {
    const loc = localByAsset.get(ex.asset);
    const localTotal = loc?.total ?? 0;
    const delta = Math.abs(ex.total - localTotal);
    if (delta > BALANCE_EPSILON) {
      issues.push({
        category: "BALANCE_MISMATCH",
        status: "HARD_DRIFT",
        detail: `${ex.asset} balance drift ${delta}`,
        field: ex.asset,
        expected: ex.total, // exchange = truth
        actual: localTotal,
      });
    }
  }
}

// CRITICAL: an order is open on the exchange that we have no local record of.
function detectGhostOrders(
  exchange: ExchangeOrder[],
  local: ExchangeOrder[],
  issues: DriftIssue[]
): void {
  const localIds = new Set(local.map((o) => o.clientOrderId || o.orderId));
  for (const ex of exchange) {
    const id = ex.clientOrderId || ex.orderId;
    if (!localIds.has(id)) {
      issues.push({
        category: "GHOST_ORDER",
        status: "CRITICAL_DRIFT",
        detail: `Unknown open order on ${ex.exchange}`,
        field: id,
        actual: `${ex.side} ${ex.size}@${ex.price}`,
      });
    }
  }
}

// HARD: we think an order is open but the exchange doesn't list it (filled/cancelled).
function detectStaleLocalOrders(
  exchange: ExchangeOrder[],
  local: ExchangeOrder[],
  issues: DriftIssue[]
): void {
  const exchangeIds = new Set(exchange.map((o) => o.clientOrderId || o.orderId));
  for (const loc of local) {
    const id = loc.clientOrderId || loc.orderId;
    if (!exchangeIds.has(id)) {
      issues.push({
        category: "STALE_LOCAL_ORDER",
        status: "HARD_DRIFT",
        detail: `Local open order no longer on exchange`,
        field: id,
      });
    }
  }
}

// HARD: exchange has a fill we haven't recorded locally.
function detectMissingFills(
  exchange: ExchangeFill[],
  local: ExchangeFill[],
  issues: DriftIssue[]
): void {
  const localFillIds = new Set(local.map((f) => f.fillId));
  for (const ex of exchange) {
    if (!localFillIds.has(ex.fillId)) {
      issues.push({
        category: "MISSING_FILL",
        status: "HARD_DRIFT",
        detail: `Fill ${ex.fillId} present on exchange, missing locally`,
        field: ex.fillId,
        actual: `${ex.side} ${ex.size}@${ex.price}`,
      });
    }
  }
}

// CRITICAL: the same fillId was applied to local state more than once.
function detectDuplicateLocalFills(local: ExchangeFill[], issues: DriftIssue[]): void {
  const seen = new Set<string>();
  for (const f of local) {
    if (seen.has(f.fillId)) {
      issues.push({
        category: "DUPLICATE_FILL",
        status: "CRITICAL_DRIFT",
        detail: `Fill ${f.fillId} applied more than once locally`,
        field: f.fillId,
      });
    }
    seen.add(f.fillId);
  }
}
