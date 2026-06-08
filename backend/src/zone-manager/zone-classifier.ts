import type { MarketZone, ZoneBands, ZoneClassifierInputs } from "./zone-types.js";

// ── Zone classifier (pure) ──────────────────────────────────────────────────────
//
// Chaos wins first (unhealthy exchange / failed reconciliation / CHAOTIC regime).
// Then price is bucketed by the contiguous zone bounds:
//   < ZONE_A_LOW                 → BELOW_ACTIVE_BAND  (defensive; don't catch a knife)
//   [ZONE_A_LOW, ZONE_A_HIGH)    → ZONE_A             (defensive accumulation)
//   [ZONE_A_HIGH, ZONE_B_HIGH)   → ZONE_B             (primary harvest)
//   [ZONE_B_HIGH, ZONE_C_HIGH]   → ZONE_C             (expansion harvest)
//   > ZONE_C_HIGH                → ABOVE_ACTIVE_BAND  (breakout candidate)
// (Zones are validated contiguous + ascending in @zig/config.)
// ──────────────────────────────────────────────────────────────────────────────

export function classifyZone(input: ZoneClassifierInputs, bands: ZoneBands): MarketZone {
  if (input.regime === "CHAOTIC" || !input.exchangeHealthy || !input.reconciliationHealthy) {
    return "CHAOTIC";
  }
  const p = input.price;
  if (p < bands.zoneALow) return "BELOW_ACTIVE_BAND";
  if (p < bands.zoneAHigh) return "ZONE_A_DEFENSIVE_ACCUMULATION";
  if (p < bands.zoneBHigh) return "ZONE_B_PRIMARY_HARVEST";
  if (p <= bands.zoneCHigh) return "ZONE_C_EXPANSION_HARVEST";
  return "ABOVE_ACTIVE_BAND";
}
