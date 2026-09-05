import { pendingAllowed } from "../paper-soak/pending-policy.js";
import type { Config } from "@zig/config";
import type { Logger } from "@zig/logger";
import type { Exchange, ManagedOrder, OrderEvent, NormalizedMarketState } from "@zig/shared-types";
import { StateEngine } from "../state-engine/index.js";
import { RiskEngine } from "../decision-gate/risk-engine.js";
import { buildRiskConfig } from "../decision-gate/risk-config.js";
import { OrderRegistry } from "../execution-engine/registry.js";
import { ExecutionPipeline } from "../execution-engine/pipeline.js";
import { PaperEngine } from "../execution-engine/paper-engine.js";
import { VirtualAccount } from "../paper-soak/virtual-account.js";
import { HarvestDriver, type ZoneView } from "../paper-soak/harvest-driver.js";
import { ZoneManager } from "../zone-manager/zone-manager.js";
import { zoneBands, zoneBehavior } from "../zone-manager/zone-config.js";
import type { ZoneClassifierInputs, MarketZone } from "../zone-manager/zone-types.js";
import { AccumulationEngine, type AccReporter } from "../accumulation/accumulation-engine.js";
import { AccumulationCycleTracker } from "../accumulation/accumulation-cycle-tracker.js";
import { AccumulationBudget } from "../accumulation/accumulation-budget.js";
import type { Candle } from "./fetch-history.js";
import { replay, makeRng } from "./market-replay.js";
import { InvariantChecker, type InvariantBreach } from "./invariants.js";

// ── Simulation harness ──────────────────────────────────────────────────────────
//
// Runs ONE window of real ZIG history through the REAL engine: the actual
// RiskEngine, SizingEngine, ExecutionPipeline, PaperEngine, OrderRegistry,
// ZoneManager, AccumulationEngine, CycleTracker and VirtualAccount. Nothing about
// the strategy is reimplemented here — the harness only supplies market data and a
// clock, which is the whole point: a reimplementation would test itself.
//
// Two things are substituted, both deliberately:
//   • TIME — every component reads Date.now() (cooldowns, bucket locks, backoffs,
//     stale-order detection, daily budget rolls). A 10k-run sweep cannot run in real
//     time, so the harness installs a virtual clock for the duration of a run. This
//     is why runs are executed sequentially rather than concurrently.
//   • WIRING — PaperSoak drives its parts with setInterval; the harness steps them
//     by hand instead so a simulated month takes milliseconds. The parts themselves
//     are constructed exactly as PaperSoak constructs them.
// ──────────────────────────────────────────────────────────────────────────────

export interface SimOptions {
  cfg: Config;
  candles: Candle[];
  seed: number;
  exchange: Exchange;
  startZig: number;
  startUsdt: number;
  log: Logger;
  // Audit sensitivity: normalize modeled book fields without changing strategy code.
  marketTransform?: (market: NormalizedMarketState) => NormalizedMarketState;
}

export interface SimResult {
  seed: number;
  passed: boolean;
  breaches: InvariantBreach[];

  startPrice: number;
  endPrice: number;
  minPrice: number;
  maxPrice: number;
  hours: number;
  halted: boolean;
  processedTicks: number;
  feesUsdt: number;
  minZig: number;
  minUsdt: number;
  maxDrawdownUsdt: number;
  maxDrawdownPct: number;
  unrecoveredZig: number;
  accumulationOpenExposureUsdt: number;
  ledgerCashError: number;
  ledgerZigError: number;

  startZig: number;
  endZig: number;
  startUsdt: number;
  endUsdt: number;

  startNav: number;
  endNav: number;
  holdNav: number;      // NAV if we had simply held the opening position
  navVsHold: number;    // endNav - holdNav

  harvestSells: number;
  harvestBuys: number;
  accBuys: number;
  accRecoveries: number;
  harvestedUsdt: number;
  surplusZig: number;
  cyclesOpen: number;
  cyclesCompleted: number;

  zoneFlipFills: number;  // legal when decided, filled after the zone turned against it
  zoneFlipQty: number;

  promotions: number;     // band-ladder rungs climbed
  demotions: number;
  reloadedZig: number;    // net reserve released to fund higher bands

  zoneTicks: Record<string, number>;
  blockedReasons: Record<string, number>;
  rejectReasons: Record<string, number>;
  relaxations: Record<string, number>;
}

// Counting reporter — same shape the real SoakReporter implements, minus Telegram.
class CountingReporter implements AccReporter {
  readonly blocked = new Map<string, number>();
  readonly rejects = new Map<string, number>();
  readonly relaxations = new Map<string, number>();
  accBuyCount = 0;
  accRecoveryCount = 0;

  decision(_intent: { side: "buy" | "sell"; quantity: number; price: number }, d: { decision: string; reasons: string[]; metadata?: Record<string, unknown> }): void {
    if (d.decision === "REJECT" || d.decision === "HALT") {
      for (const r of d.reasons) this.rejects.set(r, (this.rejects.get(r) ?? 0) + 1);
    }
    const relaxed = d.metadata?.paperRelaxations;
    if (Array.isArray(relaxed)) {
      for (const r of relaxed as string[]) this.relaxations.set(r, (this.relaxations.get(r) ?? 0) + 1);
    }
  }
  intentBlocked(reason: string): void {
    this.blocked.set(reason, (this.blocked.get(reason) ?? 0) + 1);
  }
  accBuy(): void { this.accBuyCount++; }
  accRecovery(): void { this.accRecoveryCount++; }
  fill(): void {}
}

const RealDate = Date;

export async function runSimulation(opts: SimOptions): Promise<SimResult> {
  const { cfg, candles, seed, exchange, log } = opts;
  const tickSeconds = cfg.SOAK_TICK_SECONDS;

  // ── Virtual clock ────────────────────────────────────────────────────────
  // Installed globally because the components under test call Date.now() directly.
  // Always restored in the finally block, even if a run throws.
  let now = candles[0].t;
  // Mock both APIs: daily caps use new Date(), while cooldowns use Date.now().
  class SimulationDate extends RealDate {
    constructor(value?: string | number) { super(value === undefined ? now : value); }
    static now(): number { return now; }
  }
  globalThis.Date = SimulationDate as DateConstructor;

  try {
    const stateEngine = new StateEngine(log);
    stateEngine.dispatch({ type: "MODE_CHANGED", mode: "PAPER_MODE", source: "mode-controller" });

    const riskEngine = new RiskEngine(buildRiskConfig(cfg));
    const registry = new OrderRegistry(log, null);

    const paperEngine = new PaperEngine(
      (ev) => registry.applyEvent(ev),
      (ex) => {
        const m = stateEngine.getState().market[ex];
        return m && m.bestBid !== null && m.bestAsk !== null ? { bestBid: m.bestBid, bestAsk: m.bestAsk } : null;
      },
      log,
      {
        slippageBps: cfg.PAPER_SLIPPAGE_BPS,
        fillProbability: cfg.PAPER_FILL_PROBABILITY,
        rng: makeRng(seed ^ 0x9e3779b9), // independent stream from the price path
      }
    );

    let halted = false;
    const pipeline = new ExecutionPipeline(
      stateEngine, registry, paperEngine, null, riskEngine,
      () => { halted = true; },
      log
    );

    const account = new VirtualAccount(
      {
        exchange, symbol: cfg.TRADING_SYMBOL,
        baseAsset: cfg.BASE_ASSET, quoteAsset: cfg.QUOTE_ASSET,
        reserveFloor: cfg.RESERVE_FLOOR,
        startZig: opts.startZig, startUsdt: opts.startUsdt,
        takerFeeBps: cfg.PAPER_TAKER_FEE_BPS,
        runId: `sim-${seed}`,
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

    const reporter = new CountingReporter();

    // Band-ladder activity, so a sweep can report whether higher rungs were ever
    // reached rather than leaving migration unmeasured.
    let promotions = 0;
    let demotions = 0;
    let reloadedZig = 0;

    const accBudget = cfg.ACCUMULATION_ENABLED
      ? new AccumulationBudget(opts.startUsdt, cfg.MAX_ACCUMULATION_BUDGET_USDT_PCT, cfg.MAX_DAILY_ACCUMULATION_USDT_PCT, cfg.MAX_TOTAL_USDT_DEPLOYED_PCT, cfg.MIN_USDT_RESERVE_FLOOR)
      : null;

    const accEngine = accBudget
      ? new AccumulationEngine(
          pipeline,
          new AccumulationCycleTracker(`sim-${seed}`, exchange, cfg.TRADING_SYMBOL, cfg.ACCUMULATION_RECOVERY_PROFIT_BPS, cfg.ACCUMULATION_PRINCIPAL_RECOVERY_PCT),
          accBudget,
          reporter,
          {
            exchange, symbol: cfg.TRADING_SYMBOL,
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

    const zoneManager = cfg.ZONE_MANAGER_ENABLED
      ? new ZoneManager(
          zoneBands(cfg), zoneBehavior(cfg),
          (): ZoneClassifierInputs | null => {
            const m = stateEngine.getState().market[exchange];
            if (!m || m.midPrice === null || !(m.midPrice > 0)) return null;
            return {
              price: m.midPrice,
              regime: m.volatilityRegime,
              exchangeHealthy: m.websocketStatus === "CONNECTED" && m.sequenceStatus === "HEALTHY" && m.orderbookFreshnessMs + Math.max(0, Date.now() - m.timestamp) <= 5_000,
              reconciliationHealthy: true,
            };
          },
          cfg.ZONE_EVALUATION_INTERVAL_SECONDS * 1_000,
          () => {},
          log,
          {
            enabled: cfg.PAPER_HIGHER_BANDS_ENABLED && cfg.BAND_MIGRATION_ENABLED,
            confirmationMs: Math.max(cfg.BAND_CONFIRMATION_SECONDS * 1_000, cfg.BAND_MIGRATION_DWELL_MINUTES * 60_000),
            rungs: cfg.BAND_LADDER_RUNGS,
            growth: cfg.BAND_LADDER_GROWTH,
            // Same reserve funding the live soak uses — without these the replay
            // would migrate bands for free and overstate what a higher rung can trade.
            onPromote: () => {
              const released = account.releaseReserve(cfg.BAND_RESERVE_RELOAD_ZIG, stateEngine);
              promotions++;
              reloadedZig += released;
              return released;
            },
            onDemote: () => {
              const back = account.reprotectReserve(cfg.BAND_RESERVE_RELOAD_ZIG, stateEngine);
              demotions++;
              reloadedZig -= back;
              return back;
            },
          }
        )
      : null;

    const zoneView = (): ZoneView => {
      const d = zoneManager?.currentDecision();
      if (d) return { allowed: d.allowedActions, aggression: d.harvestAggression };
      return zoneManager
        ? { allowed: { harvestSell: false, harvestRebuy: false, accumulationBuy: false, accumulationRecoverySell: false }, aggression: "REDUCED" }
        : { allowed: { harvestSell: true, harvestRebuy: true, accumulationBuy: false, accumulationRecoverySell: false }, aggression: "FULL" };
    };

    pipeline.setPaperPolicy(order => {
      zoneManager?.evaluate();
      return pendingAllowed(order, zoneView().allowed, account, accEngine, Math.max(60_000, tickSeconds * 4_000));
    });
    const driver = new HarvestDriver(
      stateEngine, pipeline, registry, account, reporter as never,
      {
        symbol: cfg.TRADING_SYMBOL, exchange,
        minOrderZig: cfg.MIN_ORDER_ZIG,
        maxOrderActivePct: cfg.MAX_ORDER_ACTIVE_PCT,
        tickMs: tickSeconds * 1_000,
        sellCooldownMs: cfg.SELL_COOLDOWN_SECONDS * 1_000,
        buyCooldownMs: cfg.BUY_COOLDOWN_SECONDS * 1_000,
        sellBucketBps: cfg.SELL_BUCKET_BPS,
        buyBucketBps: cfg.BUY_BUCKET_BPS,
        rejectBackoffMs: cfg.REJECT_BACKOFF_SECONDS * 1_000,
        maxUnrecoveredActivePct: cfg.MAX_UNRECOVERED_ACTIVE_PCT,
      },
      zoneView,
      accEngine,
      log
    );

    // ── Record the zone each order was DECIDED in ──────────────────────────
    // The zone policy gates intent creation, but orders rest and can fill much later.
    // Wrapping submit (rather than reading the zone at fill time) is what lets the
    // checker judge the engine's decision instead of the market's subsequent moves.
    const orderZone = new Map<string, MarketZone | null>();
    let submittingZone: MarketZone | null = null;
    const originalSubmit = pipeline.submit.bind(pipeline);
    pipeline.submit = async (req) => {
      const decidedIn = zoneManager?.currentDecision()?.zone ?? null;
      submittingZone = decidedIn;
      try {
        const result = await originalSubmit(req);
        if (result.accepted) orderZone.set(result.clientOrderId, decidedIn);
        return result;
      } finally { submittingZone = null; }
    };

    // ── Fill routing — mirrors main.ts's registry "fill" handler ────────────
    const tickFills: {
      side: "buy" | "sell"; qty: number; price: number;
      kind: "harvest" | "accumulation"; submittedInZone: MarketZone | null;
    }[] = [];
    let harvestSells = 0, harvestBuys = 0;
    let feesUsdt = 0, ledgerUsdt = opts.startUsdt, ledgerZig = opts.startZig;

    registry.on("fill", (ev: OrderEvent, order: ManagedOrder) => {
      if (!ev.fillId?.startsWith("PAPER-")) return;
      const size = ev.fillQuantity ?? 0;
      const price = ev.fillPrice ?? order.price;
      if (size <= 0) return;
      const isAcc = (order.reason ?? "").startsWith("acc");
      const regime = stateEngine.getState().market[exchange]?.volatilityRegime ?? null;
      const { fillId, feeUsdt } = account.applyPaperFill(
        order.side, size, price, ev.at, stateEngine, isAcc ? "accumulation" : "harvest", order.price, regime, order.cycleIds, order.rebuyDistanceBps
      );
      feesUsdt += feeUsdt;
      ledgerUsdt += (order.side === "buy" ? -1 : 1) * size * price - feeUsdt;
      ledgerZig += (order.side === "buy" ? 1 : -1) * size;
      if (isAcc) {
        const before = accEngine?.metrics().surplusZig ?? 0;
        accEngine?.onPaperFill(order.side, size, price, fillId, feeUsdt, order.cycleIds);
        const added = (accEngine?.metrics().surplusZig ?? 0) - before;
        if (added > 0) account.protectSurplus(added, stateEngine);
      }
      else if (order.side === "sell") harvestSells++;
      else harvestBuys++;
      tickFills.push({
        side: order.side, qty: size, price,
        kind: isAcc ? "accumulation" : "harvest",
        submittedInZone: orderZone.get(order.clientOrderId) ?? submittingZone,
      });
    });

    // ── Seed the opening position at the window's real opening price ────────
    const startPrice = candles[0].o;
    account.seed(stateEngine, startPrice);

    const checker = new InvariantChecker();
    const zoneTicks: Record<string, number> = {};
    const budgetCap = opts.startUsdt * cfg.MAX_ACCUMULATION_BUDGET_USDT_PCT;

    let minPrice = Infinity, maxPrice = -Infinity, endPrice = startPrice;
    let minZig = opts.startZig, minUsdt = opts.startUsdt;
    let peakNav = opts.startZig * startPrice + opts.startUsdt;
    let maxDrawdownUsdt = 0, maxDrawdownPct = 0;
    let tick = 0;
    let lastZoneEval = 0;

    // ── The run ────────────────────────────────────────────────────────────
    for (const sample of replay(candles, { exchange, symbol: cfg.TRADING_SYMBOL, tickSeconds, seed })) {
      const market = opts.marketTransform ? opts.marketTransform(sample) : sample;
      now = market.timestamp;
      tick++;
      // Reset BEFORE any fill can occur this tick. Resting orders are filled by
      // paperEngine.tick() below, i.e. before the driver runs, so clearing later
      // discards them and the invariant checker sees inventory move "without a fill".
      tickFills.length = 0;

      const mid = market.midPrice ?? 0;
      if (mid < minPrice) minPrice = mid;
      if (mid > maxPrice) maxPrice = mid;
      endPrice = mid;

      stateEngine.dispatch({ type: "MARKET_STATE_UPDATED", exchange, state: market, source: "market-ingestion" });
      zoneManager?.evaluate();
      paperEngine.tick(); // production does this on every MARKET_STATE_UPDATED

      if (zoneManager && now - lastZoneEval >= cfg.ZONE_EVALUATION_INTERVAL_SECONDS * 1_000) {
        zoneManager.evaluate();
        lastZoneEval = now;
      }
      const zone = zoneManager?.currentDecision()?.zone ?? null;
      if (zone) zoneTicks[zone] = (zoneTicks[zone] ?? 0) + 1;

      await driver.tick();

      const balanceZig = account.derive(null).totalBase;
      minZig = Math.min(minZig, balanceZig);
      minUsdt = Math.min(minUsdt, account.usdtBalance);
      const nav = balanceZig * mid + account.usdtBalance;
      peakNav = Math.max(peakNav, nav);
      maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peakNav - nav);
      maxDrawdownPct = Math.max(maxDrawdownPct, peakNav > 0 ? 100 * (peakNav - nav) / peakNav : 0);
      checker.check({
        tick, at: now,
        zig: account.derive(null).totalBase,
        usdt: account.usdtBalance,
        reserveFloor: cfg.RESERVE_FLOOR,
        minUsdtFloor: cfg.MIN_USDT_RESERVE_FLOOR,
        zone,
        fills: [...tickFills],
        accumulationOutstandingUsdt: accBudget?.snapshot().deployed ?? 0,
        accumulationBudgetCap: budgetCap,
        startingUsdt: opts.startUsdt,
      });

      if (halted) break; // a risk HALT ends the run, exactly as it would live
    }

    // ── Results ────────────────────────────────────────────────────────────
    const t = account.derive(endPrice);
    const cm = account.cycleMetrics(endPrice);
    const acc = accEngine?.metrics() ?? null;

    const startNav = opts.startZig * startPrice + opts.startUsdt;
    const endNav = t.totalBase * endPrice + account.usdtBalance;
    const holdNav = opts.startZig * endPrice + opts.startUsdt;

    const ledgerCashError = account.usdtBalance - ledgerUsdt;
    const ledgerZigError = t.totalBase - ledgerZig;
    for (const [code, error] of [["CASH_CONSERVATION", ledgerCashError], ["ZIG_CONSERVATION", ledgerZigError]] as const) {
      if (Math.abs(error) > 1e-6) checker.breaches.push({ code, detail: `ledger difference=${error}`, at: now, tick });
    }
    return {
      seed,
      halted, processedTicks: tick, feesUsdt, minZig, minUsdt,
      maxDrawdownUsdt, maxDrawdownPct, ledgerCashError, ledgerZigError,
      unrecoveredZig: account.unrecoveredZig,
      accumulationOpenExposureUsdt: acc?.openExposureUsdt ?? 0,
      passed: checker.passed,
      breaches: checker.breaches,
      startPrice, endPrice, minPrice, maxPrice,
      hours: candles.length,
      startZig: opts.startZig, endZig: t.totalBase,
      startUsdt: opts.startUsdt, endUsdt: account.usdtBalance,
      startNav, endNav, holdNav, navVsHold: endNav - holdNav,
      harvestSells, harvestBuys,
      accBuys: reporter.accBuyCount,
      accRecoveries: reporter.accRecoveryCount,
      harvestedUsdt: cm.harvestedUsdt,
      surplusZig: acc?.surplusZig ?? 0,
      cyclesOpen: cm.openCount,
      cyclesCompleted: cm.completedCount,
      zoneFlipFills: checker.zoneFlipFills,
      zoneFlipQty: checker.zoneFlipQty,
      promotions, demotions, reloadedZig,
      zoneTicks,
      blockedReasons: Object.fromEntries(reporter.blocked),
      rejectReasons: Object.fromEntries(reporter.rejects),
      relaxations: Object.fromEntries(reporter.relaxations),
    };
  } finally {
    globalThis.Date = RealDate;
  }
}
