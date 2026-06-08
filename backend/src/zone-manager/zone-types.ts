import type { VolatilityRegime } from "@zig/shared-types";

// ── Zone types ──────────────────────────────────────────────────────────────────
// The treasury acts on the current market ZONE, not on unknown historical avg cost.
// ──────────────────────────────────────────────────────────────────────────────

export type MarketZone =
  | "BELOW_ACTIVE_BAND"
  | "ZONE_A_DEFENSIVE_ACCUMULATION"
  | "ZONE_B_PRIMARY_HARVEST"
  | "ZONE_C_EXPANSION_HARVEST"
  | "ABOVE_ACTIVE_BAND"
  | "CHAOTIC";

export interface AllowedActions {
  harvestSell: boolean;
  harvestRebuy: boolean;
  accumulationBuy: boolean;
  accumulationRecoverySell: boolean;
}

export interface ZoneDecision {
  zone: MarketZone;
  price: number;
  allowedActions: AllowedActions;
  // Zone C harvests more carefully than B (wider spacing / smaller size). The driver
  // reads this to scale aggression; "FULL" in B, "REDUCED" in C/Above.
  harvestAggression: "FULL" | "REDUCED";
  bandBreakoutCandidate: boolean;
  reasons: string[];
  severity: "INFO" | "WARN" | "CRITICAL";
}

// Price bounds. NOTE: zones should be contiguous (ZONE_A_HIGH == ZONE_B_LOW, etc.).
// ACTIVE_BAND_LOW/HIGH are the harvest band (B∪C) and used for reporting/breakout.
export interface ZoneBands {
  activeBandLow: number;
  activeBandHigh: number;
  zoneALow: number;
  zoneAHigh: number;
  zoneBLow: number;
  zoneBHigh: number;
  zoneCLow: number;
  zoneCHigh: number;
}

export interface ZoneBehavior {
  zoneAAccumulationEnabled: boolean;
  zoneASellsEnabled: boolean;
  zoneBHarvestEnabled: boolean;
  zoneBAccumulationEnabled: boolean;
  zoneCHarvestEnabled: boolean;
  zoneCAccumulationEnabled: boolean;
}

export interface ZoneClassifierInputs {
  price: number; // mark price
  regime: VolatilityRegime;
  exchangeHealthy: boolean;
  reconciliationHealthy: boolean;
}
