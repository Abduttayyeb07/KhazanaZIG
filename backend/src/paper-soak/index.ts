import type { Config } from "@zig/config";
import type { Logger } from "@zig/logger";
import type { Exchange, OrderEvent, ManagedOrder } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import type { TelegramNotifier } from "../telegram/notifier.js";
import { VirtualAccount } from "./virtual-account.js";
import { HarvestDriver, type ZoneView } from "./harvest-driver.js";
import { SoakReporter } from "./reporter.js";
import { ZoneManager } from "../zone-manager/zone-manager.js";
import { zoneBands, zoneBehavior } from "../zone-manager/zone-config.js";
import type { ZoneClassifierInputs } from "../zone-manager/zone-types.js";
import type { ZoneChangeEvent } from "../zone-manager/zone-events.js";
import { AccumulationEngine } from "../accumulation/accumulation-engine.js";
import { AccumulationCycleTracker } from "../accumulation/accumulation-cycle-tracker.js";
import { AccumulationBudget } from "../accumulation/accumulation-budget.js";

const DEFAULT_ALLOW: ZoneView = {
  allowed: { harvestSell: true, harvestRebuy: true, accumulationBuy: false, accumulationRecoverySell: false },
  aggression: "FULL",
};
const CONSERVATIVE: ZoneView = {
  allowed: { harvestSell: false, harvestRebuy: true, accumulationBuy: false, accumulationRecoverySell: false },
  aggression: "REDUCED",
};

// ── Paper soak orchestrator ─────────────────────────────────────────────────────
//
// Stands up the virtual account, the harvest driver (intent generator), and the
// Telegram reporter. Live market data + virtual money + real Phase 5 rules.
//
// Runtime-adjustable knobs live in SoakSettings (set via Telegram /soak_set).
// RESERVE_FLOOR and the risk-band params are NOT here — they come from cfg so they
// always match the RiskEngine that actually enforces them (no desync footgun).
// ────────────────────────────────────────────────────────────────────────────────

export interface SoakSettings {
  exchange: Exchange;
  virtualZig: number;
  virtualUsdt: number;
  entryCost: number; // 0 = use market mid at boot
  tickSeconds: number;
  buySlicePct: number;
}

export function defaultSoakSettings(cfg: Config): SoakSettings {
  return {
    exchange: cfg.SOAK_EXCHANGE,
    virtualZig: cfg.SOAK_VIRTUAL_ZIG,
    virtualUsdt: cfg.SOAK_VIRTUAL_USDT,
    entryCost: cfg.SOAK_ENTRY_COST,
    tickSeconds: cfg.SOAK_TICK_SECONDS,
    buySlicePct: cfg.SOAK_BUY_SLICE_PCT,
  };
}

export interface PaperSoakDeps {
  cfg: Config;
  settings: SoakSettings;
  stateEngine: StateEngine;
  pipeline: ExecutionPipeline;
  registry: OrderRegistry;
  tg: TelegramNotifier;
  markFn: () => number | null;
  log: Logger;
}

export class PaperSoak {
  private readonly account: VirtualAccount;
  private readonly reporter: SoakReporter;
  private readonly driver: HarvestDriver;
  private readonly zoneManager: ZoneManager | null;
  private readonly accEngine: AccumulationEngine | null;
  private readonly d: PaperSoakDeps;
  readonly runId: string;

  constructor(deps: PaperSoakDeps) {
    this.d = deps;
    const { cfg, settings, log, tg, markFn } = deps;
    this.runId = makeRunId();

    this.account = new VirtualAccount(
      {
        exchange: settings.exchange,
        symbol: cfg.TRADING_SYMBOL,
        baseAsset: cfg.BASE_ASSET,
        quoteAsset: cfg.QUOTE_ASSET,
        reserveFloor: cfg.RESERVE_FLOOR,
        startZig: settings.virtualZig,
        startUsdt: settings.virtualUsdt,
        takerFeeBps: cfg.PAPER_TAKER_FEE_BPS,
        runId: this.runId,
        rebuyDistanceBps: cfg.MIN_REBUY_DISTANCE_BPS,
      },
      log
    );

    // Reporter: providers reference this.zoneManager/this.accEngine lazily (assigned below).
    this.reporter = new SoakReporter(
      tg,
      this.account,
      markFn,
      {
        runId: this.runId,
        summaryMs: cfg.TG_FILL_SUMMARY_INTERVAL_SECONDS * 1_000,
        zoneLabel: () => this.zoneManager?.currentDecision()?.zone ?? null,
        accMetrics: () => this.accEngine?.metrics() ?? null,
      },
      log
    );

    // Zone manager — classifies the market off the soak exchange's mid + health.
    this.zoneManager = cfg.ZONE_MANAGER_ENABLED
      ? new ZoneManager(
          zoneBands(cfg),
          zoneBehavior(cfg),
          () => this.zoneInputs(),
          cfg.ZONE_EVALUATION_INTERVAL_SECONDS * 1_000,
          (e) => this.onZoneChange(e),
          log
        )
      : null;

    // Accumulation engine — separate cycle tracker + budget; submits via the same pipeline.
    this.accEngine = cfg.ACCUMULATION_ENABLED
      ? new AccumulationEngine(
          deps.pipeline,
          new AccumulationCycleTracker(this.runId, settings.exchange, cfg.TRADING_SYMBOL, cfg.ACCUMULATION_RECOVERY_PROFIT_BPS, cfg.ACCUMULATION_PRINCIPAL_RECOVERY_PCT),
          new AccumulationBudget(settings.virtualUsdt, cfg.MAX_ACCUMULATION_BUDGET_USDT_PCT, cfg.MAX_DAILY_ACCUMULATION_USDT_PCT, cfg.MAX_TOTAL_USDT_DEPLOYED_PCT, cfg.MIN_USDT_RESERVE_FLOOR),
          this.reporter,
          {
            exchange: settings.exchange,
            symbol: cfg.TRADING_SYMBOL,
            enabled: cfg.ACCUMULATION_ENABLED,
            recoveryEnabled: cfg.ACCUMULATION_RECOVERY_ENABLED,
            trancheUsdt: cfg.ACCUMULATION_TRANCHE_USDT,
            cooldownMs: cfg.ACCUMULATION_COOLDOWN_SECONDS * 1_000,
            bucketBps: cfg.ACCUMULATION_BUCKET_BPS,
            minLiquidityUsdt: cfg.ACCUMULATION_MIN_LIQUIDITY_USDT,
            maxSpreadBps: cfg.ACCUMULATION_MAX_SPREAD_BPS,
            allowHighVol: cfg.ACCUMULATION_ALLOW_IN_HIGH_VOL,
            allowChaotic: cfg.ACCUMULATION_ALLOW_IN_CHAOTIC,
            minUsdtFloor: cfg.MIN_USDT_RESERVE_FLOOR,
            principalRecoveryPct: cfg.ACCUMULATION_PRINCIPAL_RECOVERY_PCT,
            takerFeeBps: cfg.PAPER_TAKER_FEE_BPS,
            minOrderZig: cfg.MIN_ORDER_ZIG,
          },
          log
        )
      : null;

    this.driver = new HarvestDriver(
      deps.stateEngine,
      deps.pipeline,
      deps.registry,
      this.account,
      this.reporter,
      {
        symbol: cfg.TRADING_SYMBOL,
        exchange: settings.exchange,
        minOrderZig: cfg.MIN_ORDER_ZIG,
        maxOrderActivePct: cfg.MAX_ORDER_ACTIVE_PCT,
        tickMs: settings.tickSeconds * 1_000,
        sellCooldownMs: cfg.SELL_COOLDOWN_SECONDS * 1_000,
        buyCooldownMs: cfg.BUY_COOLDOWN_SECONDS * 1_000,
        sellBucketBps: cfg.SELL_BUCKET_BPS,
        buyBucketBps: cfg.BUY_BUCKET_BPS,
        rejectBackoffMs: cfg.REJECT_BACKOFF_SECONDS * 1_000,
        maxUnrecoveredActivePct: cfg.MAX_UNRECOVERED_ACTIVE_PCT,
      },
      () => this.zoneView(),
      this.accEngine,
      log
    );
  }

  // Zone view for the driver: real decision if available, else safe defaults.
  private zoneView(): ZoneView {
    const d = this.zoneManager?.currentDecision();
    if (d) return { allowed: d.allowedActions, aggression: d.harvestAggression };
    // Manager enabled but not evaluated yet → conservative; manager disabled → legacy harvest.
    return this.zoneManager ? CONSERVATIVE : DEFAULT_ALLOW;
  }

  private zoneInputs(): ZoneClassifierInputs | null {
    const m = this.d.stateEngine.getState().market[this.d.settings.exchange];
    if (!m || m.midPrice === null || !(m.midPrice > 0)) return null;
    return {
      price: m.midPrice,
      regime: m.volatilityRegime,
      exchangeHealthy: m.websocketStatus === "CONNECTED" && m.sequenceStatus === "HEALTHY" && m.orderbookFreshnessMs <= 5_000,
      reconciliationHealthy: true, // PAPER_MODE: reconciliation not required (matches RiskEngine)
    };
  }

  private onZoneChange(e: ZoneChangeEvent): void {
    const a = e.current.allowedActions;
    const yn = (b: boolean) => (b ? "✅" : "❌");
    this.d.tg.notify(
      `🧭 <b>ZONE CHANGE</b> — ${this.d.cfg.TRADING_SYMBOL}\n` +
      `Previous: <code>${e.previous ?? "—"}</code>\n` +
      `Current: <code>${e.current.zone}</code>\n` +
      `Mark: <code>${e.current.price.toFixed(6)}</code>\n` +
      `Allowed: ${yn(a.harvestSell)} sell · ${yn(a.harvestRebuy)} rebuy · ${yn(a.accumulationBuy)} acc-buy · ${yn(a.accumulationRecoverySell)} acc-recover\n` +
      `${e.current.reasons.join("; ")}`
    );
  }

  async start(): Promise<void> {
    const { cfg, settings, stateEngine, log } = this.d;

    // Resolve the opening cost basis: explicit setting, else market mid at boot.
    let entryCost = settings.entryCost;
    if (entryCost <= 0) {
      entryCost = (await this.waitForMid(30_000)) ?? 0;
      if (entryCost <= 0) {
        log.warn("Paper soak: no market mid available — opening cost basis is 0 (harvester idle until a buy establishes cost)");
      }
    }

    this.account.seed(stateEngine, entryCost);
    // Echo the live trading params the PROCESS actually received — config drift
    // between laptop/.env/server is then visible in the first Telegram message.
    this.reporter.startup({
      Exchange: settings.exchange,
      "Virtual ZIG": settings.virtualZig,
      "Reserve floor": cfg.RESERVE_FLOOR,
      "Virtual USDT": settings.virtualUsdt,
      "Entry cost": entryCost,
      "Tick (s)": settings.tickSeconds,
      "Rebuy distance (bps)": cfg.MIN_REBUY_DISTANCE_BPS,
      "Buckets sell/buy (bps)": `${cfg.SELL_BUCKET_BPS}/${cfg.BUY_BUCKET_BPS}`,
      "Cooldowns sell/buy (s)": `${cfg.SELL_COOLDOWN_SECONDS}/${cfg.BUY_COOLDOWN_SECONDS}`,
      "Unrecovered cap (pct)": cfg.MAX_UNRECOVERED_ACTIVE_PCT,
      "Paper fee/slip (bps)": `${cfg.PAPER_TAKER_FEE_BPS}/${cfg.PAPER_SLIPPAGE_BPS}`,
      "Fill probability": cfg.PAPER_FILL_PROBABILITY,
    });
    this.reporter.start();
    this.zoneManager?.start();
    this.driver.start();
    log.warn({ exchange: settings.exchange, runId: this.runId }, "PAPER SOAK RUNNING — virtual money, real rules");
  }

  stop(): void {
    this.driver.stop();
    this.zoneManager?.stop();
    this.reporter.stop();
  }

  statusText(): string {
    return this.reporter.statusText();
  }

  fillsText(limit = 10): string {
    const fills = this.account.recentFills(limit);
    if (fills.length === 0) return "No paper fills recorded yet.";

    return (
      `<b>Recent paper fills</b>\n` +
      fills
        .map((f) => {
          const at = new Date(f.filledAt).toISOString();
          const notional = f.price * f.size;
          return (
            `${at}\n` +
            `<code>${f.side.toUpperCase()}</code> <code>${fmt(f.size)} ZIG</code> @ <code>${f.price.toFixed(6)}</code>\n` +
            `notional <code>${notional.toFixed(2)} USDT</code> fee <code>${f.fee.toFixed(2)} ${f.feeAsset}</code>\n` +
            `<code>${f.fillId}</code>`
          );
        })
        .join("\n\n")
    );
  }

  // Called from main's registry "fill" handler for PAPER- fills only. Routes by the
  // order's reason: acc-* fills update the accumulation engine, the rest are harvest.
  onPaperFill(ev: OrderEvent, order: ManagedOrder): void {
    if (order.exchange !== this.d.settings.exchange) return;
    const size = ev.fillQuantity ?? 0;
    const price = ev.fillPrice ?? order.price;
    if (size <= 0) return;
    const isAcc = (order.reason ?? "").startsWith("acc");
    const { fillId, feeUsdt } = this.account.applyPaperFill(order.side, size, price, ev.at, this.d.stateEngine, isAcc ? "accumulation" : "harvest", order.price);
    if (isAcc) this.accEngine?.onPaperFill(order.side, size, price, fillId, feeUsdt);
    else this.reporter.fill(order.side, size, price);
  }

  private async waitForMid(timeoutMs: number): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const mid = this.d.markFn();
      if (mid !== null && mid > 0) return mid;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    return this.d.markFn();
  }
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function makeRunId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `paper-run-${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
