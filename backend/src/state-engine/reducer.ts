import type { SystemState, StateAction } from "./store.js";

// ── Reducer contract ───────────────────────────────────────────────────────────
//
// Pure function. No side effects. No async. No I/O.
// Returns identical reference if nothing changed — StateEngine uses this
// to skip unnecessary event emissions.
//
// Race condition protection:
//   FILL_RECEIVED:   deduplicates by fillId — safe against WebSocket + reconciliation
//                    both delivering the same fill.
//   BALANCES_UPDATED: full replace from exchange truth — reconciliation always wins.
//   OPEN_ORDERS_UPDATED: full replace from exchange truth — reconciliation always wins.
//   MARKET_STATE_UPDATED: last-write-wins per exchange — market-ingestion drives this.
//
// ──────────────────────────────────────────────────────────────────────────────

export function reduce(state: SystemState, action: StateAction): SystemState {
  const now = Date.now();

  switch (action.type) {
    case "MARKET_STATE_UPDATED":
      return {
        ...state,
        market: { ...state.market, [action.exchange]: action.state },
        lastStateUpdateAt: now,
      };

    case "BALANCES_UPDATED":
      // Exchange truth wins — full replace, not merge
      return {
        ...state,
        balances: { ...state.balances, [action.exchange]: action.balances },
        lastStateUpdateAt: now,
      };

    case "OPEN_ORDERS_UPDATED":
      // Exchange truth wins — full replace, not merge
      return {
        ...state,
        openOrders: { ...state.openOrders, [action.exchange]: action.orders },
        lastStateUpdateAt: now,
      };

    case "FILL_RECEIVED": {
      const existing = state.fills[action.exchange];
      // Idempotency by fillId — WebSocket and reconciliation may both deliver
      // the same fill. First one wins, subsequent are dropped.
      const isDuplicate = existing.some((f) => f.fillId === action.fill.fillId);
      if (isDuplicate) return state;
      return {
        ...state,
        fills: {
          ...state.fills,
          [action.exchange]: [...existing, action.fill],
        },
        lastStateUpdateAt: now,
      };
    }

    case "RECONCILIATION_DONE":
      return {
        ...state,
        lastReconciliation: {
          ...state.lastReconciliation,
          [action.result.exchange]: action.result,
        },
        lastStateUpdateAt: now,
      };

    case "MODE_CHANGED":
      if (state.mode === action.mode) return state;
      return { ...state, mode: action.mode, lastStateUpdateAt: now };

    case "RECOVERY_COMPLETE":
      if (state.recoveryComplete) return state;
      return { ...state, recoveryComplete: true, lastStateUpdateAt: now };

    case "ACCOUNT_CLEARED":
      return {
        ...state,
        balances: { ...state.balances, [action.exchange]: [] },
        openOrders: { ...state.openOrders, [action.exchange]: [] },
        fills: { ...state.fills, [action.exchange]: [] },
        lastReconciliation: { ...state.lastReconciliation, [action.exchange]: null },
        lastStateUpdateAt: now,
      };

    default:
      return state;
  }
}
