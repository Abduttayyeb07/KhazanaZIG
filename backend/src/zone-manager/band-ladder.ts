import type { ZoneBands } from "./zone-types.js";

// ── Band ladder + migration ─────────────────────────────────────────────────────
//
// The operating plan defines a scalable ladder rather than one fixed band:
//   Band 1: 0.050–0.075 · Band 2: 0.075–0.100 · Band 3: 0.100–0.150
// "If price exits this band upward, a new harvesting band is deployed higher using
// reserve inventory."
//
// Zones inside a band are derived proportionally rather than listed, so a new rung
// cannot be added with inconsistent internals:
//   A = [low × 0.9, low)      defensive accumulation, just under the band
//   B = [low, low + 40% span) primary harvest
//   C = [B.high, high]        expansion harvest
// Applied to Band 1 this reproduces the plan's own numbers exactly
// (0.045–0.05 / 0.05–0.06 / 0.06–0.075), which is the check that the derivation
// matches the operator's intent instead of merely being tidy.
//
// Migration is CONFIRMED, never instantaneous: price must hold beyond the boundary
// for a dwell period. A single wick through 0.075 is not a regime change, and
// promoting on one tick would ratchet the band up during exactly the volatility
// the system is supposed to harvest.
// ──────────────────────────────────────────────────────────────────────────────

export const ZONE_A_FLOOR_RATIO = 0.9;
export const ZONE_B_SPAN_RATIO = 0.4;

export interface BandRung {
  level: number;
  low: number;
  high: number;
}

export function bandsForRung(r: BandRung): ZoneBands {
  const span = r.high - r.low;
  const bHigh = r.low + span * ZONE_B_SPAN_RATIO;
  return {
    activeBandLow: r.low,
    activeBandHigh: r.high,
    zoneALow: r.low * ZONE_A_FLOOR_RATIO,
    zoneAHigh: r.low,
    zoneBLow: r.low,
    zoneBHigh: bHigh,
    zoneCLow: bHigh,
    zoneCHigh: r.high,
  };
}

// Ladder built upward from the configured base band. Each rung starts where the
// previous ended. The first two rungs share the base span and widening begins at
// the third, which reproduces the plan's ladder exactly:
//   0.050-0.075 · 0.075-0.100 · 0.100-0.150   (spans 0.025, 0.025, 0.050)
// Higher bands are wider because price ranges expand with level; applying `growth`
// from rung two instead would put Band 2 at 0.075-0.125 and miss the plan.
export function buildLadder(baseLow: number, baseHigh: number, rungs: number, growth: number): BandRung[] {
  const out: BandRung[] = [];
  const baseSpan = baseHigh - baseLow;
  let low = baseLow;
  for (let level = 1; level <= Math.max(1, rungs); level++) {
    const span = baseSpan * Math.pow(growth, Math.max(0, level - 2));
    out.push({ level, low, high: low + span });
    low += span;
  }
  return out;
}

export type MigrationAction = "HOLD" | "PROMOTE" | "DEMOTE";

export interface MigrationState {
  level: number;          // 1-based index into the ladder
  aboveSinceMs: number | null;
  belowSinceMs: number | null;
}

export interface MigrationDecision {
  action: MigrationAction;
  nextLevel: number;
  reason: string;
  state: MigrationState;
}

// Pure. Promotes when price holds above the rung's high for `dwellMs`, demotes when
// it holds below the rung's Zone A floor for the same period. Demotion matters as
// much as promotion: without it a spike would strand the system in a band the
// market has left, where nothing is tradable.
export function evaluateMigration(
  price: number,
  now: number,
  ladder: BandRung[],
  state: MigrationState,
  dwellMs: number
): MigrationDecision {
  const idx = Math.min(Math.max(state.level, 1), ladder.length) - 1;
  const rung = ladder[idx];
  const bands = bandsForRung(rung);

  const above = price > rung.high;
  const below = price < bands.zoneALow;

  const aboveSinceMs = above ? state.aboveSinceMs ?? now : null;
  const belowSinceMs = below ? state.belowSinceMs ?? now : null;
  const next: MigrationState = { level: state.level, aboveSinceMs, belowSinceMs };

  if (above && aboveSinceMs !== null && now - aboveSinceMs >= dwellMs && rung.level < ladder.length) {
    return {
      action: "PROMOTE",
      nextLevel: rung.level + 1,
      reason: `held above ${rung.high.toFixed(6)} for ${Math.round((now - aboveSinceMs) / 60_000)}m`,
      // Dwell timers reset on a change of rung, so the new band is judged fresh.
      state: { level: rung.level + 1, aboveSinceMs: null, belowSinceMs: null },
    };
  }

  if (below && belowSinceMs !== null && now - belowSinceMs >= dwellMs && rung.level > 1) {
    return {
      action: "DEMOTE",
      nextLevel: rung.level - 1,
      reason: `held below ${bands.zoneALow.toFixed(6)} for ${Math.round((now - belowSinceMs) / 60_000)}m`,
      state: { level: rung.level - 1, aboveSinceMs: null, belowSinceMs: null },
    };
  }

  return { action: "HOLD", nextLevel: rung.level, reason: "within band", state: next };
}
