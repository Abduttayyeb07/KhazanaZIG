import type {
  NormalizedMarketState,
  ExchangeBalance,
  ExchangeOrder,
  ExchangeFill,
  ReconciliationResult,
  OperationalMode,
} from "@zig/shared-types";

// ── Truth ownership model ──────────────────────────────────────────────────────
//
//  Exchange   = ultimate truth (always wins on mismatch)
//  StateEngine = operational truth (in-memory, fast, rebuilt on startup)
//  DB          = checkpoint truth  (persistent, slightly delayed)
//
//  Who dispatches what:
//
//  MARKET_STATE_UPDATED  → market-ingestion ONLY (WebSocket feed)
//  BALANCES_UPDATED      → state-recovery (startup) OR reconciliation (repair)
//  OPEN_ORDERS_UPDATED   → state-recovery (startup) OR reconciliation (repair)
//  FILL_RECEIVED         → execution-engine (confirmed fill) OR reconciliation (repair)
//  RECONCILIATION_DONE   → reconciliation engine ONLY
//  MODE_CHANGED          → mode-controller ONLY
//  RECOVERY_COMPLETE     → state-recovery ONLY (fires once per boot, opens execution gate)
//
// ──────────────────────────────────────────────────────────────────────────────

export type ActionSource =
  | "market-ingestion"
  | "state-recovery"
  | "reconciliation"
  | "execution-engine"
  | "mode-controller"
  | "session-manager"
  | "paper-soak";

export interface SystemState {
  market: {
    bybit: NormalizedMarketState | null;
    mexc: NormalizedMarketState | null;
  };
  balances: {
    bybit: ExchangeBalance[];
    mexc: ExchangeBalance[];
  };
  openOrders: {
    bybit: ExchangeOrder[];
    mexc: ExchangeOrder[];
  };
  fills: {
    bybit: ExchangeFill[];
    mexc: ExchangeFill[];
  };
  lastReconciliation: {
    bybit: ReconciliationResult | null;
    mexc: ReconciliationResult | null;
  };
  mode: OperationalMode;
  recoveryComplete: boolean;
  lastStateUpdateAt: number;
}

export type StateAction =
  | { type: "MARKET_STATE_UPDATED"; exchange: "bybit" | "mexc"; state: NormalizedMarketState; source: "market-ingestion" }
  | { type: "BALANCES_UPDATED"; exchange: "bybit" | "mexc"; balances: ExchangeBalance[]; source: "state-recovery" | "reconciliation" | "paper-soak" }
  | { type: "OPEN_ORDERS_UPDATED"; exchange: "bybit" | "mexc"; orders: ExchangeOrder[]; source: "state-recovery" | "reconciliation" }
  | { type: "FILL_RECEIVED"; exchange: "bybit" | "mexc"; fill: ExchangeFill; source: "execution-engine" | "reconciliation" }
  | { type: "RECONCILIATION_DONE"; result: ReconciliationResult; source: "reconciliation" }
  | { type: "MODE_CHANGED"; mode: OperationalMode; source: "mode-controller" }
  | { type: "RECOVERY_COMPLETE"; source: "state-recovery" }
  // Clears an exchange's account state (balances/orders/fills/recon) — dispatched
  // when credentials are removed, so stale data stops showing. Fills here are the
  // in-memory display mirror; the durable treasury ledger is separate.
  | { type: "ACCOUNT_CLEARED"; exchange: "bybit" | "mexc"; source: "session-manager" };

export function initialState(): SystemState {
  return {
    market: { bybit: null, mexc: null },
    balances: { bybit: [], mexc: [] },
    openOrders: { bybit: [], mexc: [] },
    fills: { bybit: [], mexc: [] },
    lastReconciliation: { bybit: null, mexc: null },
    mode: "READ_ONLY",
    recoveryComplete: false,
    lastStateUpdateAt: 0,
  };
}
