import type { Logger } from "@zig/logger";
import type { Exchange, ExchangeBalance, ExchangeFill, DerivedTreasury, VolatilityRegime } from "@zig/shared-types";
import { deriveTreasury } from "../treasury/derive.js";
import type { StateEngine } from "../state-engine/index.js";
import { CycleTracker, type CycleMetrics, type HarvestCycle } from "./cycle-tracker.js";
import { rebuyDistanceBps, type RebuyDistanceConfig } from "./rebuy-distance.js";

// ── Virtual account for the paper soak ──────────────────────────────────────────
//
// Holds fake ZIG + USDT balances and a PAPER-ONLY fill ledger. It mirrors the
// virtual balances into the state engine so the real Risk/Sizing engines see them,
// and tracks cost basis / realized PnL via the same pure deriveTreasury() the real
// treasury uses. NOTHING here touches the real treasury ledger or DB — it is fully
// disposable. The synthetic opening position exists solely to give the harvester a
// cost basis to trade against (this is the paper ledger, not the immutable one).
// ────────────────────────────────────────────────────────────────────────────────

export interface VirtualAccountOptions {
  exchange: Exchange;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  reserveFloor: number;
  startZig: number;
  startUsdt: number;
  takerFeeBps: number;
  runId: string;
  rebuyDistanceBps: number;
  // Regime-scaled rebuy distances. Optional so existing callers/tests keep the
  // single fixed distance above.
  rebuyDistance?: RebuyDistanceConfig;
}

export class VirtualAccount {
  private zig: number;
  private usdt: number;
  private startingActiveZig = 0;
  private day = "";
  private dailySellZig = 0;
  private dailyBuyUsdt = 0;
  private protectedSurplus = 0;
  // Reserve released into the active pool to fund a higher harvesting band
  // ("a new harvesting band is deployed higher using reserve inventory"). Tracked
  // separately from protectedSurplus so a reload can be undone on demotion without
  // disturbing surplus that accumulation earned.
  private reserveReleased = 0;

  get protectedZig(): number {
    return Math.max(this.opts.reserveFloor + this.protectedSurplus - this.reserveReleased, 0);
  }
  get reloadedZig(): number { return this.reserveReleased; }

  // Move reserve into the active pool. Returns what was actually released, which
  // may be less than requested: the reserve is finite, and a reload must never
  // manufacture inventory that does not exist.
  releaseReserve(qty: number, stateEngine: StateEngine): number {
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    const room = Math.max(this.opts.reserveFloor + this.protectedSurplus - this.reserveReleased, 0);
    const released = Math.min(qty, room);
    if (released <= 0) return 0;
    this.reserveReleased += released;
    this.publishBalances(stateEngine);
    return released;
  }

  // Re-protect previously released reserve (on demotion). Capped at what is still
  // held, so a run that sold into a reload cannot re-protect ZIG it no longer owns.
  reprotectReserve(qty: number, stateEngine: StateEngine): number {
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    const restorable = Math.min(qty, this.reserveReleased, Math.max(this.zig - this.protectedZig, 0));
    if (restorable <= 0) return 0;
    this.reserveReleased -= restorable;
    this.publishBalances(stateEngine);
    return restorable;
  }
  protectSurplus(qty: number, stateEngine: StateEngine): void {
    if (!Number.isFinite(qty) || qty < 0 || qty > this.activeZig + 1e-6) throw Error("Invalid surplus reserve transfer");
    this.protectedSurplus += qty;
    this.publishBalances(stateEngine);
  }
  private readonly fills: ExchangeFill[] = [];
  private readonly opts: VirtualAccountOptions;
  private readonly tracker: CycleTracker;
  private readonly log: Logger;

  constructor(opts: VirtualAccountOptions, log: Logger) {
    this.opts = opts;
    this.zig = opts.startZig;
    this.usdt = opts.startUsdt;
    this.tracker = new CycleTracker(opts.runId, opts.exchange, opts.symbol, opts.rebuyDistanceBps);
    this.log = log.child({ module: "virtual-account" });
  }

  // Seed the opening position (cost basis) and publish virtual balances to state.
  seed(stateEngine: StateEngine, entryCost: number): void {
    if (this.zig > 0 && entryCost > 0) {
      this.fills.push({
        exchange: this.opts.exchange,
        fillId: "PAPER-OPENING",
        orderId: "PAPER-OPENING",
        clientOrderId: "PAPER-OPENING",
        symbol: this.opts.symbol,
        side: "buy",
        price: entryCost,
        size: this.zig,
        fee: 0,
        feeAsset: this.opts.quoteAsset,
        filledAt: Date.now(),
      });
    }
    this.startingActiveZig = this.activeZig;
    this.publishBalances(stateEngine);
    this.log.info(
      { zig: this.zig, usdt: this.usdt, entryCost, reserveFloor: this.opts.reserveFloor, active: this.activeZig },
      "Virtual account seeded"
    );
  }

  get activeZig(): number {
    return Math.max(this.zig - this.protectedZig, 0);
  }
  get usdtBalance(): number {
    return this.usdt;
  }
  get avgCost(): number {
    return this.derive(null).avgCost;
  }

  derive(markPrice: number | null): DerivedTreasury {
    return deriveTreasury(this.fills, {
      baseAsset: this.opts.baseAsset,
      quoteAsset: this.opts.quoteAsset,
      reserveFloor: this.protectedZig,
      markPrice,
    });
  }

  recentFills(limit = 10): ExchangeFill[] {
    return this.fills.slice(-limit).reverse();
  }

  // ── Cycle tracking surface (drives driver gates + reporting) ──────────────
  get startingActive(): number {
    return this.startingActiveZig;
  }
  get unrecoveredZig(): number {
    return this.tracker.unrecoveredTotal();
  }
  get harvestRebuyReserveUsdt(): number {
    return this.tracker.rebuyReserveUsdt();
  }
  openCyclesForRebuy(ask: number): HarvestCycle[] {
    return this.tracker.openCyclesForRebuy(ask);
  }
  sellBucketOccupied(price: number, bps: number): boolean {
    return this.tracker.sellBucketOccupied(price, bps);
  }
  cycleMetrics(mark: number | null): CycleMetrics {
    return this.tracker.metrics(mark);
  }
  cycles(): readonly HarvestCycle[] {
    return this.tracker.all();
  }

  // Apply a simulated paper fill: move virtual cash/inventory and record it for
  // cost-basis derivation. A synthetic taker fee makes paper PnL more honest.
  applyPaperFill(
    side: "buy" | "sell",
    size: number,
    price: number,
    at: number,
    stateEngine: StateEngine,
    kind: "harvest" | "accumulation" = "harvest",
    intentPrice = price, // submitted price (pre-slippage) — anchors sell bucket occupancy
    regime: VolatilityRegime | null = null, // drives the rebuy distance for this cycle
    cycleIds?: string[],
    distanceOverride?: number
  ): { fillId: string; feeUsdt: number } {
    const feeUsdt = price * size * (this.opts.takerFeeBps / 10_000);
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0) throw Error("Invalid paper fill");
    if (side === "buy" && price * size + feeUsdt > this.usdt + 1e-7) throw Error("PAPER_CASH_OVERDRAW");
    if (side === "sell" && size > this.activeZig + 1e-7) throw Error("PAPER_RESERVE_OVERDRAW");
    const day = new Date(at).toISOString().slice(0,10);
    if (day !== this.day) { this.day = day; this.dailySellZig = 0; this.dailyBuyUsdt = 0; }
    if (side === "buy") this.dailyBuyUsdt += price * size + feeUsdt;
    else this.dailySellZig += size;
    if (side === "buy") {
      this.zig += size;
      this.usdt -= price * size + feeUsdt;
    } else {
      this.zig -= size;
      this.usdt += price * size - feeUsdt;
    }


    const fillId = `PAPER-LEDGER-${at}-${Math.random().toString(36).slice(2, 8)}`;
    this.fills.push({
      exchange: this.opts.exchange,
      fillId,
      orderId: "PAPER",
      clientOrderId: "PAPER",
      symbol: this.opts.symbol,
      side,
      price,
      size,
      fee: feeUsdt,
      feeAsset: this.opts.quoteAsset,
      filledAt: at,
    });

    // Harvest fills drive the harvest cycles here; accumulation fills are routed to
    // the AccumulationEngine by the caller (separate tracker) — balances + cost basis
    // above are shared, cycle bookkeeping is not.
    if (kind === "harvest") {
      if (side === "sell") {
        // Resolve the rebuy distance from the regime that produced this sell, so a
        // cycle opened in a violent market waits for a proportionally deeper dip.
        const distance =
          this.opts.rebuyDistance && regime
            ? rebuyDistanceBps(regime, this.opts.rebuyDistance)
            : this.opts.rebuyDistanceBps;
        this.tracker.onSell(fillId, size, price, feeUsdt, intentPrice, distanceOverride ?? distance);
      } else {
        this.tracker.onBuy(fillId, size, price, feeUsdt, cycleIds);
      }
    }

    this.publishBalances(stateEngine);
    return { fillId, feeUsdt };
  }

  private publishBalances(stateEngine: StateEngine): void {
    const now = Date.now();
    const balances: ExchangeBalance[] = [
      { exchange: this.opts.exchange, asset: this.opts.baseAsset, available: this.zig, locked: 0, total: this.zig, fetchedAt: now },
      { exchange: this.opts.exchange, asset: this.opts.quoteAsset, available: this.usdt, locked: 0, total: this.usdt, fetchedAt: now },
    ];
    stateEngine.dispatch({ type: "PAPER_RISK_UPDATED", exchange: this.opts.exchange, source: "paper-soak", ledger: {
      runId: this.opts.runId, day: this.day, dailySellZig: this.dailySellZig, dailyBuyUsdt: this.dailyBuyUsdt,
      startingActive: this.startingActiveZig, startingUsdt: this.opts.startUsdt,
      protectedZig: this.protectedZig, zig: this.zig, usdt: this.usdt,
      averageCost: this.avgCost || undefined,
    }});
    stateEngine.dispatch({ type: "BALANCES_UPDATED", exchange: this.opts.exchange, balances, source: "paper-soak" });
  }
}
