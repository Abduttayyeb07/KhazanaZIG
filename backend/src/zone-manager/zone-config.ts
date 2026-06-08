import type { Config } from "@zig/config";
import type { ZoneBands, ZoneBehavior } from "./zone-types.js";

export function zoneBands(cfg: Config): ZoneBands {
  return {
    activeBandLow: cfg.ACTIVE_BAND_LOW,
    activeBandHigh: cfg.ACTIVE_BAND_HIGH,
    zoneALow: cfg.ZONE_A_LOW,
    zoneAHigh: cfg.ZONE_A_HIGH,
    zoneBLow: cfg.ZONE_B_LOW,
    zoneBHigh: cfg.ZONE_B_HIGH,
    zoneCLow: cfg.ZONE_C_LOW,
    zoneCHigh: cfg.ZONE_C_HIGH,
  };
}

export function zoneBehavior(cfg: Config): ZoneBehavior {
  return {
    zoneAAccumulationEnabled: cfg.ZONE_A_ACCUMULATION_ENABLED,
    zoneASellsEnabled: cfg.ZONE_A_SELLS_ENABLED,
    zoneBHarvestEnabled: cfg.ZONE_B_HARVEST_ENABLED,
    zoneBAccumulationEnabled: cfg.ZONE_B_ACCUMULATION_ENABLED,
    zoneCHarvestEnabled: cfg.ZONE_C_HARVEST_ENABLED,
    zoneCAccumulationEnabled: cfg.ZONE_C_ACCUMULATION_ENABLED,
  };
}
