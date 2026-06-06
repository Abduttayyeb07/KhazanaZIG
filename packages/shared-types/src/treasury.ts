export interface InventoryPool {
  asset: string;
  amount: number;
  lastUpdated: number;
}

export interface TreasuryInventory {
  active: InventoryPool;
  reserve: InventoryPool;
  totalAmount: number;
}

export interface TreasurySnapshot {
  timestamp: number;
  baseAsset: string;
  quoteAsset: string;
  inventory: TreasuryInventory;
  quoteBalance: number;
  openOrderCount: number;
  realizedPnlUsdt: number;
  inventoryDriftPct: number;
}

// ── Derived treasury state ─────────────────────────────────────────────────────
//
// The financial meaning derived PURELY from the fill ledger (+ reserve floor +
// current mark price). Must be exactly reconstructable from fills alone — given
// the same fills and floor, deriveTreasury() always yields the same result.
//
// Inventory model: RESERVE FLOOR.
//   reserveBase = min(totalBase, reserveFloor)   ← protected, never sold into
//   activeBase  = max(totalBase - reserveFloor, 0) ← harvestable surplus
// ──────────────────────────────────────────────────────────────────────────────
export interface DerivedTreasury {
  baseAsset: string;
  quoteAsset: string;

  reserveFloor: number;
  totalBase: number;    // net base held, derived from fills
  activeBase: number;   // harvestable surplus above the floor
  reserveBase: number;  // protected portion

  avgCost: number;            // weighted-average acquisition price (quote per base)
  realizedPnlUsdt: number;    // cumulative harvested (sum of realized gains on sells)
  totalFeesUsdt: number;      // cumulative fees, normalized to quote

  markPrice: number | null;          // latest mark (from market state), if available
  unrealizedPnlUsdt: number | null;  // (mark - avgCost) * totalBase
  inventoryValueUsdt: number | null; // totalBase * mark

  fillCount: number;
  lastFillAt: number | null;
  derivedAt: number;
}

export interface DeriveTreasuryOptions {
  baseAsset: string;
  quoteAsset: string;
  reserveFloor: number;
  markPrice?: number | null;
}
