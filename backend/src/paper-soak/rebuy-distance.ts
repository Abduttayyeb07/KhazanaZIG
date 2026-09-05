import type { VolatilityRegime } from "@zig/shared-types";

// ── Dynamic rebuy distance ──────────────────────────────────────────────────────
//
// How far below a sell the matching rebuy target sits, scaled by the volatility
// regime (operating plan: low 3-4% · medium 4-6% · high 5-8%).
//
// A single fixed distance is wrong in both directions. Too tight in a fast market
// and the rebuy fills on ordinary noise, so the cycle closes without earning the
// spread it existed to capture. Too wide in a calm market and the dip never arrives,
// so the cycle stays open, inventory stays deployed, and the deployment cap
// eventually pauses selling altogether. Scaling with regime is what makes the
// re-entry quality-controlled rather than arbitrary.
//
// Pure and total: every regime maps to a distance, and the result is never below
// MIN_REBUY_DISTANCE_BPS, so a mis-set regime value cannot put a rebuy target at or
// above its own sell price.
// ──────────────────────────────────────────────────────────────────────────────

export interface RebuyDistanceConfig {
  minBps: number;
  lowVolBps: number;
  normalVolBps: number;
  highVolBps: number;
  chaoticBps: number;
}

export function rebuyDistanceBps(regime: VolatilityRegime, cfg: RebuyDistanceConfig): number {
  const byRegime =
    regime === "LOW" ? cfg.lowVolBps
    : regime === "NORMAL" ? cfg.normalVolBps
    : regime === "HIGH" ? cfg.highVolBps
    : cfg.chaoticBps;

  return Math.max(byRegime, cfg.minBps);
}
