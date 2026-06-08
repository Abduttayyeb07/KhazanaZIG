import type { Logger } from "@zig/logger";
import { classifyZone } from "./zone-classifier.js";
import { decideZone } from "./zone-policy.js";
import type { AllowedActions, ZoneBands, ZoneBehavior, ZoneClassifierInputs, ZoneDecision } from "./zone-types.js";
import type { ZoneChangeHandler } from "./zone-events.js";

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

export class ZoneManager {
  private decision: ZoneDecision | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly log: Logger;

  constructor(
    private readonly bands: ZoneBands,
    private readonly behavior: ZoneBehavior,
    private readonly getInputs: () => ZoneClassifierInputs | null,
    private readonly intervalMs: number,
    private readonly onChange: ZoneChangeHandler,
    log: Logger
  ) {
    this.log = log.child({ module: "zone-manager" });
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
      if (!input || !(input.price > 0)) return; // no/zero market data → keep last decision, act on nothing
      const zone = classifyZone(input, this.bands);
      const next = decideZone(zone, input.price, this.behavior);
      const prevZone = this.decision?.zone ?? null;
      this.decision = next;
      if (prevZone !== zone) {
        this.log.warn({ prev: prevZone, zone, price: input.price, allowed: next.allowedActions }, "Zone change");
        this.onChange({ previous: prevZone, current: next, at: Date.now() });
      }
    } catch (err) {
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
