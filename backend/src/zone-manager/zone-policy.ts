import type { AllowedActions, MarketZone, ZoneBehavior, ZoneDecision } from "./zone-types.js";

// ── Zone policy (pure) ──────────────────────────────────────────────────────────
//
// Maps a zone → which actions are allowed. Tick order downstream is always:
//   harvest sell → harvest rebuy → accumulation recovery sell → accumulation buy
// (manage existing obligations before growing the treasury).
//
//   BELOW : defensive — finish open cycles only, no fresh sells, NO fresh accumulation
//   A     : defensive accumulation — buy small, no sells
//   B     : primary harvest — sell strength, rebuy weakness, recover acc lots
//   C     : expansion harvest — same actions, REDUCED aggression (wider/smaller)
//   ABOVE : breakout candidate — harvest existing inventory + recover, no accumulation
//   CHAOTIC: everything off
// ──────────────────────────────────────────────────────────────────────────────

const NONE: AllowedActions = { harvestSell: false, harvestRebuy: false, accumulationBuy: false, accumulationRecoverySell: false };

export function decideZone(zone: MarketZone, price: number, b: ZoneBehavior): ZoneDecision {
  let actions: AllowedActions;
  let aggression: ZoneDecision["harvestAggression"] = "FULL";
  let breakout = false;
  let severity: ZoneDecision["severity"] = "INFO";
  let reason: string;

  switch (zone) {
    case "CHAOTIC":
      actions = { ...NONE };
      severity = "CRITICAL";
      reason = "Chaotic market — all new actions disabled";
      break;

    case "BELOW_ACTIVE_BAND":
      // Not "cheap = buy" — possible band breakdown. Finish obligations, protect capital.
      actions = { harvestSell: false, harvestRebuy: true, accumulationBuy: false, accumulationRecoverySell: true };
      severity = "WARN";
      reason = "Below active band — defensive (no fresh sells or accumulation)";
      break;

    case "ZONE_A_DEFENSIVE_ACCUMULATION":
      actions = {
        harvestSell: b.zoneASellsEnabled,
        harvestRebuy: true,
        accumulationBuy: b.zoneAAccumulationEnabled,
        accumulationRecoverySell: false,
      };
      reason = "Zone A — defensive accumulation (buy weakness, do not sell)";
      break;

    case "ZONE_B_PRIMARY_HARVEST":
      actions = {
        harvestSell: b.zoneBHarvestEnabled,
        harvestRebuy: true,
        accumulationBuy: b.zoneBAccumulationEnabled,
        accumulationRecoverySell: true,
      };
      reason = "Zone B — primary harvest (sell strength, rebuy weakness)";
      break;

    case "ZONE_C_EXPANSION_HARVEST":
      actions = {
        harvestSell: b.zoneCHarvestEnabled,
        harvestRebuy: true,
        accumulationBuy: b.zoneCAccumulationEnabled,
        accumulationRecoverySell: true,
      };
      aggression = "REDUCED";
      reason = "Zone C — expansion harvest (careful, wider spacing)";
      break;

    case "ABOVE_ACTIVE_BAND":
      actions = { harvestSell: true, harvestRebuy: true, accumulationBuy: false, accumulationRecoverySell: true };
      aggression = "REDUCED";
      breakout = true;
      severity = "WARN";
      reason = "Above active band — BAND_BREAKOUT_CANDIDATE (do not chase)";
      break;
  }

  return { zone, price, allowedActions: actions, harvestAggression: aggression, bandBreakoutCandidate: breakout, reasons: [reason], severity };
}
