import { pendingAllowed } from "./pending-policy.js";
import type { Config } from "@zig/config";
import type { Logger } from "@zig/logger";
import type { Exchange, OrderEvent, ManagedOrder } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import type { Notifier } from "../notify/notifier.js";
import type { DashboardSoak } from "../api/server.js";
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
  allowed: { harvestSell: false, harvestRebuy: false, accumulationBuy: false, accumulationRecoverySell: false },
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
  notifier: Notifier;
  markFn: () => number | null;
  log: Logger;
}

export class PaperSoak {
  private readonly account: VirtualAccount;
  private readonly reporter: SoakReporter;
  private readonly driver: HarvestDriver;
  private readonly zoneManager: ZoneManager | null;
  private readonly accEngine: AccumulationEngine | null;
  private readonly accBudget: AccumulationBudget | null;
  private readonly d: PaperSoakDeps;
  private active = false;
  readonly runId: string;

  constructor(deps: PaperSoakDeps) {
    this.d = deps;
    const { cfg, settings, log, notifier, markFn } = deps;
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
        rebuyDistance: {
          minBps: cfg.MIN_REBUY_DISTANCE_BPS,
          lowVolBps: cfg.REBUY_DISTANCE_LOW_VOL_BPS,
          normalVolBps: cfg.REBUY_DISTANCE_NORMAL_VOL_BPS,
          highVolBps: cfg.REBUY_DISTANCE_HIGH_VOL_BPS,
          chaoticBps: cfg.REBUY_DISTANCE_CHAOTIC_BPS,
        },
      },
      log
    );

    // Reporter: providers reference this.zoneManager/this.accEngine lazily (assigned below).
    this.reporter = new SoakReporter(
      notifier,
      this.account,
      markFn,
      {
        runId: this.runId,
        summaryMs: cfg.SUMMARY_INTERVAL_SECONDS * 1_000,
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
          log,
          {
            enabled: cfg.PAPER_HIGHER_BANDS_ENABLED && cfg.BAND_MIGRATION_ENABLED,
            confirmationMs: Math.max(cfg.BAND_CONFIRMATION_SECONDS * 1_000, cfg.BAND_MIGRATION_DWELL_MINUTES * 60_000),
            rungs: cfg.BAND_LADDER_RUNGS,
            growth: cfg.BAND_LADDER_GROWTH,
            // A higher band is funded by releasing reserve into the active pool,
            // per the plan. Demotion re-protects it, so a spike cannot permanently
            // strip the reserve.
            onPromote: (level) => {
              const released = this.account.releaseReserve(cfg.BAND_RESERVE_RELOAD_ZIG, deps.stateEngine);
              this.d.notifier.notify(
                `Band ${level} deployed — released ${fmt(released)} ZIG from reserve into the active pool`
              );
              return released;
            },
            onDemote: (level) => {
              const reprotected = this.account.reprotectReserve(cfg.BAND_RESERVE_RELOAD_ZIG, deps.stateEngine);
              this.d.notifier.notify(
                `Band ${level} restored — re-protected ${fmt(reprotected)} ZIG back into reserve`
              );
              return reprotected;
            },
          }
        )
      : null;

    // Accumulation engine — separate cycle tracker + budget; submits via the same pipeline.
    // The budget is held so /zone can report outstanding vs recycled capital.
    this.accBudget = cfg.ACCUMULATION_ENABLED
      ? new AccumulationBudget(settings.virtualUsdt, cfg.MAX_ACCUMULATION_BUDGET_USDT_PCT, cfg.MAX_DAILY_ACCUMULATION_USDT_PCT, cfg.MAX_TOTAL_USDT_DEPLOYED_PCT, cfg.MIN_USDT_RESERVE_FLOOR)
      : null;

    this.accEngine = this.accBudget
      ? new AccumulationEngine(
          deps.pipeline,
          new AccumulationCycleTracker(this.runId, settings.exchange, cfg.TRADING_SYMBOL, cfg.ACCUMULATION_RECOVERY_PROFIT_BPS, cfg.ACCUMULATION_PRINCIPAL_RECOVERY_PCT),
          this.accBudget,
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
            liquidityMultiple: cfg.ACCUMULATION_LIQUIDITY_MULTIPLE,
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

    deps.pipeline.setPaperPolicy(order => {
      if (!this.active || order.exchange !== settings.exchange || order.symbol !== cfg.TRADING_SYMBOL) return false;
      this.zoneManager?.evaluate();
      return pendingAllowed(order, this.zoneView().allowed, this.account, this.accEngine, Math.max(60_000, settings.tickSeconds * 4_000));
    });
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
    this.zoneManager?.evaluate();
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
      exchangeHealthy: m.websocketStatus === "CONNECTED" && m.sequenceStatus === "HEALTHY" && m.orderbookFreshnessMs + Math.max(0, Date.now() - m.timestamp) <= 5_000,
      reconciliationHealthy: true, // PAPER_MODE: reconciliation not required (matches RiskEngine)
    };
  }

  // One line. The full permission matrix lives in the dashboard's zone panel; the
  // event feed only needs to say that the regime changed and when.
  private onZoneChange(e: ZoneChangeEvent): void {
    this.d.notifier.notify(
      `Zone ${e.previous ?? "—"} → ${e.current.zone} at ${e.current.price.toFixed(6)}`
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

    for (const order of this.d.registry.openOrders().filter(o => o.paper)) await this.d.pipeline.cancel(order.clientOrderId);
    this.account.seed(stateEngine, entryCost);
    this.active = true;
    // Echo the live trading params the PROCESS actually received — config drift
    // between laptop/.env/server is then visible in the first Telegram message.
    this.reporter.startup({
      Exchange: settings.exchange,
      "Virtual ZIG": settings.virtualZig,
      "Reserve floor": cfg.RESERVE_FLOOR,
      "Virtual USDT": settings.virtualUsdt,
      "Entry cost": entryCost,
      "Tick (s)": settings.tickSeconds,
      "Rebuy distance (bps)": `min ${cfg.MIN_REBUY_DISTANCE_BPS} · low ${cfg.REBUY_DISTANCE_LOW_VOL_BPS} · normal ${cfg.REBUY_DISTANCE_NORMAL_VOL_BPS} · high ${cfg.REBUY_DISTANCE_HIGH_VOL_BPS} · chaotic ${cfg.REBUY_DISTANCE_CHAOTIC_BPS}`,
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
    this.active = false;
    for (const order of this.d.registry.openOrders().filter(o => o.paper)) void this.d.pipeline.cancel(order.clientOrderId);
    this.driver.stop();
    this.zoneManager?.stop();
    this.reporter.stop();
  }

  statusText(): string {
    return this.reporter.statusText();
  }

  // Structured live state for the dashboard. Mirrors what /status and /zone report
  // in Telegram, but as data rather than formatted text.
  snapshot(): DashboardSoak {
    const mark = this.d.markFn();
    const t = this.account.derive(mark);
    const cm = this.account.cycleMetrics(mark);
    const acc = this.accEngine?.metrics() ?? null;
    const budget = this.accBudget?.snapshot() ?? null;
    const d = this.zoneManager?.currentDecision() ?? null;
    const fills = this.reporter.cumulativeFills();

    const nav = mark !== null ? t.totalBase * mark + this.account.usdtBalance : null;
    const baseline = this.reporter.baseline;

    return {
      running: true,
      runId: this.runId,
      startedAt: this.reporter.startedAtMs || null,

      zone: d?.zone ?? null,
      zoneReason: d?.reasons.join("; ") ?? null,
      harvestAggression: d?.harvestAggression ?? null,
      breakoutCandidate: d?.bandBreakoutCandidate ?? false,
      allowed: d?.allowedActions ?? null,

      zig: t.totalBase,
      usdt: this.account.usdtBalance,
      activeZig: t.activeBase,
      reserveZig: t.reserveBase,
      avgCost: t.avgCost,
      markPrice: mark,

      nav,
      baselineNav: baseline,
      navDelta: nav !== null && baseline !== null ? nav - baseline : null,

      harvest: {
        openCycles: cm.openCount,
        completedCycles: cm.completedCount,
        completionRate: cm.completionRate,
        harvestedUsdt: cm.harvestedUsdt,
        unrecoveredZig: cm.unrecoveredZig,
        nearestRebuyTarget: cm.nearestRebuyTarget,
        sells: fills.sells,
        buys: fills.buys,
      },

      accumulation: acc && budget
        ? {
            enabled: true,
            openLots: acc.openCount,
            recoveredLots: acc.principalRecoveredCount,
            usdtDeployed: acc.usdtDeployed,
            usdtRecovered: acc.usdtRecovered,
            surplusZig: acc.surplusZig,
            openExposureUsdt: acc.openExposureUsdt,
            budgetRemaining: budget.budgetRemaining,
            dailyRemaining: budget.dailyRemaining,
            recycled: budget.recycled,
          }
        : null,

      recentFills: this.account.recentFills(12).map((f) => ({
        side: f.side, qty: f.size, price: f.price, at: f.filledAt, kind: "paper",
      })),
      blocked: this.reporter.blockedReasons().slice(0, 8),
    };
  }

  // /zone — what the policy is allowing right now, and the budget behind it.
  zoneText(): string {
    const d = this.zoneManager?.currentDecision();
    if (!this.zoneManager) return "🧭 Zone manager is disabled (ZONE_MANAGER_ENABLED=false) — legacy harvest policy in effect.";
    if (!d) return "🧭 Zone not evaluated yet (waiting for market data). All new actions are held until it is.";

    const yn = (b: boolean) => (b ? "✅" : "❌");
    const a = d.allowedActions;
    const acc = this.accEngine?.metrics() ?? null;
    const budget = this.accBudget?.snapshot() ?? null;
    return (
      `🧭 <b>Zone:</b> <code>${d.zone}</code>${d.bandBreakoutCandidate ? " ⚠️ BREAKOUT CANDIDATE" : ""}\n` +
      `Mark: <code>${d.price.toFixed(6)}</code> · Harvest aggression: <code>${d.harvestAggression}</code>\n` +
      `Allowed: ${yn(a.harvestSell)} sell · ${yn(a.harvestRebuy)} rebuy · ${yn(a.accumulationBuy)} acc-buy · ${yn(a.accumulationRecoverySell)} acc-recover\n` +
      `${d.reasons.join("; ")}\n` +
      (budget
        ? `\n💰 <b>Accumulation budget</b>\n` +
          `Outstanding: <code>${budget.deployed.toFixed(2)}</code> · Available: <code>${budget.budgetRemaining.toFixed(2)}</code> USDT\n` +
          `Today left: <code>${budget.dailyRemaining.toFixed(2)}</code> · Recycled: <code>${budget.recycled.toFixed(2)}</code> · Lifetime: <code>${budget.lifetimeDeployed.toFixed(2)}</code> USDT`
        : "\n💰 Accumulation disabled (ACCUMULATION_ENABLED=false)") +
      (acc ? `\nOpen lots: <code>${acc.openCount}</code> · Recovered: <code>${acc.principalRecoveredCount}</code> · Surplus ZIG: <code>${fmt(acc.surplusZig)}</code>` : "")
    );
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
    const regime = this.d.stateEngine.getState().market[this.d.settings.exchange]?.volatilityRegime ?? null;
    const { fillId, feeUsdt } = this.account.applyPaperFill(
      order.side, size, price, ev.at, this.d.stateEngine, isAcc ? "accumulation" : "harvest", order.price, regime, order.cycleIds, order.rebuyDistanceBps
    );
    if (isAcc) {
      const before = this.accEngine?.metrics().surplusZig ?? 0;
      this.accEngine?.onPaperFill(order.side, size, price, fillId, feeUsdt, order.cycleIds);
      const added = (this.accEngine?.metrics().surplusZig ?? 0) - before;
      if (added > 0) this.account.protectSurplus(added, this.d.stateEngine);
    }
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
