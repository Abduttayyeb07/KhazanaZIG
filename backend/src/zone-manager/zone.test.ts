import { classifyZone } from "./zone-classifier.js";
import { decideZone } from "./zone-policy.js";
import { buildLadder, bandsForRung, evaluateMigration } from "./band-ladder.js";
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


// ── 3. Band ladder + migration (operating plan: 0.05-0.075 -> 0.075-0.10 -> 0.10-0.15)
console.log("\n3. Band ladder");
{
  const ladder = buildLadder(0.05, 0.075, 3, 2);
  ok("rung 1 = 0.050-0.075", ladder[0].low === 0.05 && Math.abs(ladder[0].high - 0.075) < 1e-9, JSON.stringify(ladder[0]));
  ok("rung 2 = 0.075-0.100", Math.abs(ladder[1].low - 0.075) < 1e-9 && Math.abs(ladder[1].high - 0.1) < 1e-9, JSON.stringify(ladder[1]));
  ok("rung 3 = 0.100-0.150", Math.abs(ladder[2].low - 0.1) < 1e-9 && Math.abs(ladder[2].high - 0.15) < 1e-9, JSON.stringify(ladder[2]));

  // The derivation must reproduce the operator's own Band 1 zones, or the ladder
  // is internally tidy but disagrees with the plan it implements.
  const b1 = bandsForRung(ladder[0]);
  ok("band 1 zone A = 0.045-0.050", Math.abs(b1.zoneALow - 0.045) < 1e-9 && Math.abs(b1.zoneAHigh - 0.05) < 1e-9, `${b1.zoneALow}-${b1.zoneAHigh}`);
  ok("band 1 zone B = 0.050-0.060", Math.abs(b1.zoneBLow - 0.05) < 1e-9 && Math.abs(b1.zoneBHigh - 0.06) < 1e-9, `${b1.zoneBLow}-${b1.zoneBHigh}`);
  ok("band 1 zone C = 0.060-0.075", Math.abs(b1.zoneCLow - 0.06) < 1e-9 && Math.abs(b1.zoneCHigh - 0.075) < 1e-9, `${b1.zoneCLow}-${b1.zoneCHigh}`);

  const b2 = bandsForRung(ladder[1]);
  ok("band 2 zone B = 0.075-0.085", Math.abs(b2.zoneBHigh - 0.085) < 1e-9, String(b2.zoneBHigh));
}

console.log("\n4. Band migration is confirmed, reversible, and bounded");
{
  const ladder = buildLadder(0.05, 0.075, 3, 2);
  const dwell = 60 * 60_000; // 1h
  let st = { level: 1, aboveSinceMs: null as number | null, belowSinceMs: null as number | null };
  const t0 = 1_000_000;

  // A wick above the band must NOT promote — that is the whole point of dwell.
  let d = evaluateMigration(0.08, t0, ladder, st, dwell);
  ok("spike alone does not promote", d.action === "HOLD", d.action);
  st = d.state;

  d = evaluateMigration(0.08, t0 + dwell - 1, ladder, st, dwell);
  ok("still held just before dwell elapses", d.action === "HOLD", d.action);
  st = d.state;

  d = evaluateMigration(0.08, t0 + dwell, ladder, st, dwell);
  ok("promotes once dwell is satisfied", d.action === "PROMOTE" && d.nextLevel === 2, `${d.action} ${d.nextLevel}`);
  st = d.state;
  ok("dwell timers reset on promotion", st.aboveSinceMs === null && st.belowSinceMs === null);

  // Dropping back into the band must not immediately demote.
  d = evaluateMigration(0.08, t0 + dwell + 10, ladder, st, dwell);
  ok("inside new band → hold", d.action === "HOLD", d.action);
  st = d.state;

  // A sustained fall below the new band's floor demotes — without this the ladder
  // is a one-way ratchet that strands the system in an untradable band.
  const t1 = t0 + dwell + 100;
  d = evaluateMigration(0.05, t1, ladder, st, dwell);
  st = d.state;
  d = evaluateMigration(0.05, t1 + dwell, ladder, st, dwell);
  ok("sustained fall demotes", d.action === "DEMOTE" && d.nextLevel === 1, `${d.action} ${d.nextLevel}`);
  st = d.state;

  // The ladder is bounded at both ends.
  d = evaluateMigration(0.01, t1 + 2 * dwell, ladder, st, dwell);
  st = d.state;
  d = evaluateMigration(0.01, t1 + 3 * dwell, ladder, st, dwell);
  ok("cannot demote below rung 1", d.action === "HOLD" && d.nextLevel === 1, `${d.action} ${d.nextLevel}`);

  let top = { level: 3, aboveSinceMs: null as number | null, belowSinceMs: null as number | null };
  let e = evaluateMigration(0.5, t0, ladder, top, dwell);
  top = e.state;
  e = evaluateMigration(0.5, t0 + dwell, ladder, top, dwell);
  ok("cannot promote above the top rung", e.action === "HOLD" && e.nextLevel === 3, `${e.action} ${e.nextLevel}`);
}

console.log(`
══════ ${pass} passed, ${fail} failed ══════`);
process.exit(fail === 0 ? 0 : 1);
