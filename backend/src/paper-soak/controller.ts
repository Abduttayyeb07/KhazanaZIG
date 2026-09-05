import type { Config } from "@zig/config";
import type { Logger } from "@zig/logger";
import type { Exchange, OrderEvent, ManagedOrder } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import type { ModeController } from "../decision-gate/mode-controller.js";
import type { Notifier } from "../notify/notifier.js";
import { PaperSoak, defaultSoakSettings, type SoakSettings } from "./index.js";
import type { DashboardSoak } from "../api/server.js";

// ── Soak controller ─────────────────────────────────────────────────────────────
//
// Owns the mutable soak settings and the single live PaperSoak instance. The
// dashboard is the only control surface: start() flips the engine into PAPER_MODE
// and builds a fresh soak from the current settings, stop() returns it to READ_ONLY.
//
// The soak NEVER starts on its own. It exists only between an explicit start and
// stop, so "not running" is the default state on every boot.
//
// Settings can only change while STOPPED, so a run is internally consistent from
// first tick to last.
// ────────────────────────────────────────────────────────────────────────────────

// The shape the dashboard sees while no soak is running.
const IDLE_SOAK: DashboardSoak = {
  running: false, runId: null, startedAt: null,
  zone: null, zoneReason: null, harvestAggression: null, breakoutCandidate: false, allowed: null,
  zig: 0, usdt: 0, activeZig: 0, reserveZig: 0, avgCost: 0, markPrice: null,
  nav: null, baselineNav: null, navDelta: null,
  harvest: {
    openCycles: 0, completedCycles: 0, completionRate: 0, harvestedUsdt: 0,
    unrecoveredZig: 0, nearestRebuyTarget: null, sells: 0, buys: 0,
  },
  accumulation: null,
  recentFills: [],
  blocked: [],
};

export interface SoakControllerDeps {
  cfg: Config;
  stateEngine: StateEngine;
  pipeline: ExecutionPipeline;
  registry: OrderRegistry;
  modeController: ModeController;
  notifier: Notifier;
  markFn: () => number | null;
  log: Logger;
}

export interface SoakActionResult {
  ok: boolean;
  error?: string;
}

export class SoakController {
  private soak: PaperSoak | null = null;
  private settings: SoakSettings;
  private readonly d: SoakControllerDeps;

  constructor(deps: SoakControllerDeps) {
    this.d = deps;
    this.settings = defaultSoakSettings(deps.cfg);
  }

  get running(): boolean {
    return this.soak !== null;
  }

  currentSettings(): SoakSettings {
    return { ...this.settings };
  }

  async start(): Promise<SoakActionResult> {
    if (this.soak) return { ok: false, error: "Soak already running" };

    // Flip the engine into PAPER_MODE (safe — paper only). The driver also
    // re-checks mode on every tick as a second guard.
    this.d.modeController.transition("PAPER_MODE", "paper soak start", "system");

    this.soak = new PaperSoak({
      cfg: this.d.cfg,
      settings: { ...this.settings },
      stateEngine: this.d.stateEngine,
      pipeline: this.d.pipeline,
      registry: this.d.registry,
      notifier: this.d.notifier,
      markFn: this.d.markFn,
      log: this.d.log,
    });

    try {
      await this.soak.start();
      return { ok: true };
    } catch (err) {
      // Never leave a half-built soak attached — the next start would report
      // "already running" for something that never began.
      this.soak = null;
      this.d.modeController.transition("READ_ONLY", "paper soak start failed", "system");
      return { ok: false, error: err instanceof Error ? err.message : "failed to start" };
    }
  }

  stop(): SoakActionResult {
    if (!this.soak) return { ok: false, error: "Soak is not running" };
    this.soak.stop();
    this.soak = null;
    this.d.modeController.transition("READ_ONLY", "paper soak stop", "system");
    return { ok: true };
  }

  // Settings are locked during a run so a soak's parameters cannot change mid-flight.
  updateSettings(patch: Partial<SoakSettings>): SoakActionResult {
    if (this.soak) return { ok: false, error: "Stop the soak before changing settings" };

    const next = { ...this.settings, ...patch };
    const err = validateSettings(next);
    if (err) return { ok: false, error: err };

    this.settings = next;
    return { ok: true };
  }

  // Called from main's registry "fill" handler for PAPER- fills.
  onPaperFill(ev: OrderEvent, order: ManagedOrder): void {
    this.soak?.onPaperFill(ev, order);
  }

  // Live state for the dashboard. Idle is a real state, not an error.
  snapshot(): DashboardSoak {
    return this.soak?.snapshot() ?? IDLE_SOAK;
  }
}

function validateSettings(s: SoakSettings): string | null {
  if (s.exchange !== "bybit" && s.exchange !== "mexc") return "exchange must be bybit or mexc";
  if (!Number.isFinite(s.virtualZig) || s.virtualZig < 0) return "virtualZig must be >= 0";
  if (!Number.isFinite(s.virtualUsdt) || s.virtualUsdt < 0) return "virtualUsdt must be >= 0";
  if (!Number.isFinite(s.entryCost) || s.entryCost < 0) return "entryCost must be >= 0 (0 = use market mid)";
  if (!Number.isInteger(s.tickSeconds) || s.tickSeconds <= 0) return "tickSeconds must be a positive integer";
  if (!Number.isFinite(s.buySlicePct) || s.buySlicePct <= 0 || s.buySlicePct > 1) return "buySlicePct must be in (0,1]";
  return null;
}

export type { Exchange };
