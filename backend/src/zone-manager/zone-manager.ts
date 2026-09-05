import type { Logger } from "@zig/logger";
import { classifyZone } from "./zone-classifier.js";
import { decideZone } from "./zone-policy.js";
import type { AllowedActions, ZoneBands, ZoneBehavior, ZoneClassifierInputs, ZoneDecision } from "./zone-types.js";
import type { ZoneChangeHandler } from "./zone-events.js";
import { buildLadder, bandsForRung, evaluateMigration, type BandRung, type MigrationState } from "./band-ladder.js";

// ── Zone manager service ────────────────────────────────────────────────────────
//
// Re-classifies the market every ZONE_EVALUATION_INTERVAL and holds the current
// ZoneDecision. The driver/accumulation engine read `allowed()` each tick.
// Emits a change event (for Telegram) only when the zone actually flips.
// Fails safe: with no market data / before first eval, `allowed()` returns all-false.
// ──────────────────────────────────────────────────────────────────────────────

const NO_ACTIONS: AllowedActions = {
  harvestSell: false,
  harvestRebuy: false,
  accumulationBuy: false,
  accumulationRecoverySell: false,
};

export interface LadderOptions {
  enabled: boolean;
  confirmationMs: number;
  rungs?: number;
  growth?: number;
  // Return the ZIG actually moved, which may be less than requested when the
  // reserve is exhausted or already committed.
  onPromote?: (level: number) => number;
  onDemote?: (level: number) => number;
}

export class ZoneManager {
  private decision: ZoneDecision | null = null;
  private timer: NodeJS.Timeout | null = null;
  private migration: MigrationState = { level: 1, aboveSinceMs: null, belowSinceMs: null };
  private readonly rungs: BandRung[];
  private readonly log: Logger;

  constructor(
    private readonly bands: ZoneBands,
    private readonly behavior: ZoneBehavior,
    private readonly getInputs: () => ZoneClassifierInputs | null,
    private readonly intervalMs: number,
    private readonly onChange: ZoneChangeHandler,
    log: Logger,
    private readonly ladder: LadderOptions = { enabled: false, confirmationMs: 900_000 }
  ) {
    this.log = log.child({ module: "zone-manager" });
    this.rungs = ladder.enabled
      ? buildLadder(bands.activeBandLow, bands.activeBandHigh, ladder.rungs ?? 3, ladder.growth ?? 2)
      : [];
  }

  // Current rung (1-based) — surfaced so the dashboard can show which band is live.
  get bandLevel(): number {
    return this.migration.level;
  }

  start(): void {
    this.evaluate();
    this.timer = setInterval(() => this.evaluate(), this.intervalMs);
    this.log.info({ intervalMs: this.intervalMs }, "Zone manager started");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  evaluate(): void {
    try {
      const input = this.getInputs();
      if (!input || !Number.isFinite(input.price) || !(input.price > 0)) { this.decision = null; return; } // no/zero market data → keep last decision, act on nothing
      let selected = this.bands;
      let bandIndex = 0;

      if (this.ladder.enabled && this.rungs.length > 0) {
        // Migration is only considered while the venue is healthy and the market is
        // not chaotic: promoting off a disordered book would deploy reserve into
        // exactly the conditions the risk engine refuses to trade.
        const healthy = input.exchangeHealthy && input.reconciliationHealthy && input.regime !== "CHAOTIC";

        if (healthy) {
          const decision = evaluateMigration(
            input.price, Date.now(), this.rungs, this.migration, this.ladder.confirmationMs
          );
          this.migration = decision.state;

          if (decision.action === "PROMOTE") {
            // Fund the new band from reserve, as the plan requires. The handler
            // reports what was ACTUALLY released — the reserve is finite.
            const released = this.ladder.onPromote?.(decision.nextLevel) ?? 0;
            this.log.warn({ level: decision.nextLevel, released, reason: decision.reason }, "Band promoted");
          } else if (decision.action === "DEMOTE") {
            // Without this the ladder is a one-way ratchet: a single sustained spike
            // would strand the system in a band the market has left, where its zones
            // make nothing tradable.
            const reprotected = this.ladder.onDemote?.(decision.nextLevel) ?? 0;
            this.log.warn({ level: decision.nextLevel, reprotected, reason: decision.reason }, "Band demoted");
          }
        } else {
          // Unhealthy input must not accrue dwell time toward a promotion.
          this.migration = { ...this.migration, aboveSinceMs: null, belowSinceMs: null };
        }

        const rung = this.rungs[Math.min(this.migration.level, this.rungs.length) - 1];
        bandIndex = rung.level - 1;
        if (bandIndex > 0) selected = bandsForRung(rung);
      }
      const zone = classifyZone(input, selected);
      const next = decideZone(zone, input.price, this.behavior);
      next.bandIndex = bandIndex;
      next.bandLow = selected.activeBandLow;
      next.bandHigh = selected.activeBandHigh;
      if (this.ladder.enabled && zone === "ABOVE_ACTIVE_BAND") {
        next.allowedActions.harvestSell = false;
        next.reasons.push("Above band — new sells paused until the higher rung is confirmed by dwell time.");
      }
      if (bandIndex > 0) next.reasons.push(`Active inventory band ${bandIndex + 1}: ${selected.activeBandLow} - ${selected.activeBandHigh}`);
      const prevZone = this.decision?.zone ?? null;
      this.decision = next;
      if (prevZone !== zone) {
        this.log.warn({ prev: prevZone, zone, price: input.price, allowed: next.allowedActions }, "Zone change");
        this.onChange({ previous: prevZone, current: next, at: Date.now() });
      }
    } catch (err) {
      this.decision = null;
      this.log.warn({ err }, "Zone evaluation failed");
    }
  }

  currentDecision(): ZoneDecision | null {
    return this.decision;
  }

  allowed(): AllowedActions {
    return this.decision?.allowedActions ?? NO_ACTIONS;
  }

  aggression(): "FULL" | "REDUCED" {
    return this.decision?.harvestAggression ?? "REDUCED";
  }
}
