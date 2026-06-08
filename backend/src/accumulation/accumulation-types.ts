import type { Exchange } from "@zig/shared-types";

// ── Accumulation cycle (buy-first; the inverse of a harvest cycle) ───────────────
// Buy ZIG in deep weakness → when price recovers, sell only enough to reclaim USDT
// PRINCIPAL and KEEP the surplus ZIG. Surplus = treasury ZIG growth.
// ──────────────────────────────────────────────────────────────────────────────

export type AccumulationCycleStatus =
  | "OPEN"
  | "PARTIALLY_RECOVERED"
  | "PRINCIPAL_RECOVERED"
  | "COMPLETED"
  | "CANCELLED";

export interface AccumulationCycle {
  cycleId: string;
  runId: string;
  exchange: Exchange;
  symbol: string;
  status: AccumulationCycleStatus;
  buyFillIds: string[];
  recoverySellFillIds: string[];
  boughtQty: number;
  recoveredSellQty: number;
  surplusZigQty: number;
  avgBuyPrice: number;
  avgRecoverySellPrice?: number;
  targetRecoveryPrice: number;
  usdtSpent: number;      // principal deployed (qty × buy price)
  usdtRecovered: number;  // gross USDT reclaimed by recovery sells
  feesUsdt: number;
  openedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AccumulationMetrics {
  openCount: number;
  principalRecoveredCount: number;
  usdtDeployed: number;       // gross principal currently/ever deployed (open cycles)
  usdtRecovered: number;
  surplusZig: number;         // ZIG retained from principal-recovered cycles
  openExposureUsdt: number;   // principal not yet recovered on open cycles
}
