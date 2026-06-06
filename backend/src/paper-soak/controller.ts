import type { Config } from "@zig/config";
import type { Logger } from "@zig/logger";
import type { Exchange, OrderEvent, ManagedOrder } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import type { ModeController } from "../decision-gate/mode-controller.js";
import type { TelegramNotifier } from "../telegram/notifier.js";
import type { TelegramCommandListener } from "../telegram/command-listener.js";
import { PaperSoak, defaultSoakSettings, type SoakSettings } from "./index.js";

// ── Soak controller ─────────────────────────────────────────────────────────────
//
// Owns the mutable soak settings and the single live PaperSoak instance, and wires
// the Telegram commands. /soak_start flips the engine into PAPER_MODE and builds a
// fresh soak from the current settings; /soak_stop returns it to READ_ONLY.
// Settings can only change while STOPPED (so a run is internally consistent).
// ────────────────────────────────────────────────────────────────────────────────

export interface SoakControllerDeps {
  cfg: Config;
  stateEngine: StateEngine;
  pipeline: ExecutionPipeline;
  registry: OrderRegistry;
  modeController: ModeController;
  tg: TelegramNotifier;
  markFn: () => number | null;
  log: Logger;
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

  async start(reply: (t: string) => void): Promise<void> {
    if (this.soak) {
      reply("ℹ️ Soak already running. /status for snapshot, /soak_stop to stop.");
      return;
    }
    // Flip the engine into PAPER_MODE (safe — paper only). The driver also
    // re-checks mode on every tick as a second guard.
    this.d.modeController.transition("PAPER_MODE", "paper soak start", "system");

    this.soak = new PaperSoak({
      cfg: this.d.cfg,
      settings: { ...this.settings },
      stateEngine: this.d.stateEngine,
      pipeline: this.d.pipeline,
      registry: this.d.registry,
      tg: this.d.tg,
      markFn: this.d.markFn,
      log: this.d.log,
    });
    await this.soak.start();
    reply("▶️ <b>Paper soak started.</b> You'll get a message on every decision and fill.");
  }

  stop(reply: (t: string) => void): void {
    if (!this.soak) {
      reply("ℹ️ Soak is not running.");
      return;
    }
    this.soak.stop();
    this.soak = null;
    this.d.modeController.transition("READ_ONLY", "paper soak stop", "system");
    reply("⏹️ <b>Paper soak stopped.</b> Engine back to READ_ONLY.");
  }

  status(reply: (t: string) => void): void {
    if (!this.soak) {
      reply(`⏸️ Soak not running.\n\n${this.configText()}`);
      return;
    }
    reply(`▶️ <b>Soak running</b>\n\n${this.soak.statusText()}`);
  }

  set(args: string[], reply: (t: string) => void): void {
    if (this.soak) {
      reply("⚠️ Stop the soak first (/soak_stop) before changing settings.");
      return;
    }
    if (args.length === 0) {
      reply(`Usage: <code>/soak_set key=value</code>\n\n${this.configText()}`);
      return;
    }
    const changed: string[] = [];
    for (const arg of args) {
      const [k, v] = arg.split("=");
      const key = (k ?? "").trim().toLowerCase();
      const val = (v ?? "").trim();
      if (!key || !val) { reply(`Bad pair: <code>${arg}</code> (use key=value)`); return; }
      const err = this.applySetting(key, val);
      if (err) { reply(`⚠️ ${err}`); return; }
      changed.push(`${key}=${val}`);
    }
    reply(`✅ Updated: <code>${changed.join(", ")}</code>\n\n${this.configText()}`);
  }

  // Called from main's registry "fill" handler for PAPER- fills.
  onPaperFill(ev: OrderEvent, order: ManagedOrder): void {
    this.soak?.onPaperFill(ev, order);
  }

  // Register all Telegram commands on the listener.
  register(listener: TelegramCommandListener): void {
    listener.on("/soak_start", (_a, reply) => this.start(reply));
    listener.on("/soak_stop", (_a, reply) => this.stop(reply));
    listener.on("/status", (_a, reply) => this.status(reply));
    listener.on("/soak_set", (a, reply) => this.set(a, reply));
    listener.on("/soak_config", (_a, reply) => reply(this.configText()));
    listener.on("/help", (_a, reply) => reply(this.helpText()));
  }

  private applySetting(key: string, val: string): string | null {
    const num = Number(val);
    switch (key) {
      case "exchange":
        if (val !== "bybit" && val !== "mexc") return "exchange must be bybit or mexc";
        this.settings.exchange = val as Exchange;
        return null;
      case "zig":
        if (!Number.isFinite(num) || num < 0) return "zig must be ≥ 0";
        this.settings.virtualZig = num;
        return null;
      case "usdt":
        if (!Number.isFinite(num) || num < 0) return "usdt must be ≥ 0";
        this.settings.virtualUsdt = num;
        return null;
      case "entry":
        if (!Number.isFinite(num) || num < 0) return "entry must be ≥ 0 (0 = use market mid)";
        this.settings.entryCost = num;
        return null;
      case "tick":
        if (!Number.isInteger(num) || num <= 0) return "tick must be a positive integer (seconds)";
        this.settings.tickSeconds = num;
        return null;
      case "buyslice":
        if (!Number.isFinite(num) || num <= 0 || num > 1) return "buyslice must be in (0,1]";
        this.settings.buySlicePct = num;
        return null;
      default:
        return `unknown setting '${key}'. Settable: exchange, zig, usdt, entry, tick, buyslice`;
    }
  }

  private configText(): string {
    const s = this.settings;
    return (
      `⚙️ <b>Soak settings</b>\n` +
      `exchange: <code>${s.exchange}</code>\n` +
      `zig: <code>${s.virtualZig}</code> · usdt: <code>${s.virtualUsdt}</code>\n` +
      `entry: <code>${s.entryCost === 0 ? "market mid" : s.entryCost}</code> · tick: <code>${s.tickSeconds}s</code> · buyslice: <code>${s.buySlicePct}</code>\n` +
      `reserve floor: <code>${this.d.cfg.RESERVE_FLOOR}</code> (set in .env — matches risk engine)`
    );
  }

  private helpText(): string {
    return (
      `🤖 <b>ZIG Khazana — Soak commands</b>\n` +
      `/soak_start — flip to PAPER_MODE and begin\n` +
      `/soak_stop — stop and return to READ_ONLY\n` +
      `/status — current portfolio snapshot\n` +
      `/soak_config — show current settings\n` +
      `/soak_set key=value — change a setting (stopped only)\n` +
      `   keys: exchange, zig, usdt, entry, tick, buyslice\n` +
      `   e.g. <code>/soak_set zig=6000000 usdt=15000 tick=30</code>`
    );
  }
}
