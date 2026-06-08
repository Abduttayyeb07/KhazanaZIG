import { classifyZone } from "./zone-classifier.js";
import { decideZone } from "./zone-policy.js";
import type { ZoneBands, ZoneBehavior } from "./zone-types.js";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} (got ${got})`); }
}

const bands: ZoneBands = {
  activeBandLow: 0.05, activeBandHigh: 0.075,
  zoneALow: 0.045, zoneAHigh: 0.05, zoneBLow: 0.05, zoneBHigh: 0.06, zoneCLow: 0.06, zoneCHigh: 0.075,
};
const behavior: ZoneBehavior = {
  zoneAAccumulationEnabled: true, zoneASellsEnabled: false,
  zoneBHarvestEnabled: true, zoneBAccumulationEnabled: false,
  zoneCHarvestEnabled: true, zoneCAccumulationEnabled: false,
};
const healthy = { exchangeHealthy: true, reconciliationHealthy: true } as const;

console.log("\n1. Zone classification");
ok("0.042 → BELOW", classifyZone({ price: 0.042, regime: "NORMAL", ...healthy }, bands) === "BELOW_ACTIVE_BAND");
ok("0.049 → ZONE_A", classifyZone({ price: 0.049, regime: "NORMAL", ...healthy }, bands) === "ZONE_A_DEFENSIVE_ACCUMULATION");
ok("0.050 → ZONE_B (edge → upper)", classifyZone({ price: 0.05, regime: "NORMAL", ...healthy }, bands) === "ZONE_B_PRIMARY_HARVEST");
ok("0.055 → ZONE_B", classifyZone({ price: 0.055, regime: "NORMAL", ...healthy }, bands) === "ZONE_B_PRIMARY_HARVEST");
ok("0.068 → ZONE_C", classifyZone({ price: 0.068, regime: "NORMAL", ...healthy }, bands) === "ZONE_C_EXPANSION_HARVEST");
ok("0.080 → ABOVE", classifyZone({ price: 0.08, regime: "NORMAL", ...healthy }, bands) === "ABOVE_ACTIVE_BAND");
ok("CHAOTIC regime → CHAOTIC", classifyZone({ price: 0.055, regime: "CHAOTIC", ...healthy }, bands) === "CHAOTIC");
ok("unhealthy exchange → CHAOTIC", classifyZone({ price: 0.055, regime: "NORMAL", exchangeHealthy: false, reconciliationHealthy: true }, bands) === "CHAOTIC");

console.log("\n2. Zone policy");
const a = decideZone("ZONE_A_DEFENSIVE_ACCUMULATION", 0.049, behavior);
ok("A: accumulation on, sells off", a.allowedActions.accumulationBuy && !a.allowedActions.harvestSell);
const b = decideZone("ZONE_B_PRIMARY_HARVEST", 0.055, behavior);
ok("B: harvest sell+rebuy, recovery on, no acc-buy", b.allowedActions.harvestSell && b.allowedActions.harvestRebuy && b.allowedActions.accumulationRecoverySell && !b.allowedActions.accumulationBuy);
const c = decideZone("ZONE_C_EXPANSION_HARVEST", 0.068, behavior);
ok("C: harvest on, REDUCED aggression", c.allowedActions.harvestSell && c.harvestAggression === "REDUCED");
const above = decideZone("ABOVE_ACTIVE_BAND", 0.08, behavior);
ok("Above: breakout candidate, no acc-buy", above.bandBreakoutCandidate && !above.allowedActions.accumulationBuy);
const below = decideZone("BELOW_ACTIVE_BAND", 0.042, behavior);
ok("Below: no sells, no acc-buy, rebuy on", !below.allowedActions.harvestSell && !below.allowedActions.accumulationBuy && below.allowedActions.harvestRebuy);
const ch = decideZone("CHAOTIC", 0.055, behavior);
ok("CHAOTIC: all off", !ch.allowedActions.harvestSell && !ch.allowedActions.harvestRebuy && !ch.allowedActions.accumulationBuy && !ch.allowedActions.accumulationRecoverySell);

console.log(`\n══════ ${pass} passed, ${fail} failed ══════`);
process.exit(fail === 0 ? 0 : 1);
