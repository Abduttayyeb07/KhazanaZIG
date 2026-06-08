import type { Exchange } from "@zig/shared-types";

// ── Harvest cycle tracker ───────────────────────────────────────────────────────
//
// Turns paper sells into trackable round-trips. Each SELL opens a cycle with a
// rebuy target; BUYs FIFO-match the oldest eligible open cycles and close them.
// This is what makes "did it actually harvest?" answerable — completed cycles, not
// raw realized PnL. Reconstructable from the paper fill stream by runId.
// ────────────────────────────────────────────────────────────────────────────────

export type CycleStatus = "OPEN" | "PARTIALLY_REBOUGHT" | "COMPLETED";

export interface HarvestCycle {
  cycleId: string;
  runId: string;
  exchange: Exchange;
  symbol: string;
  status: CycleStatus;
  sellFillIds: string[];
  buyFillIds: string[];
  soldQty: number;
  reboughtQty: number;
  unrecoveredQty: number;
  avgSellPrice: number;
  avgRebuyPrice?: number;
  rebuyTargetPrice: number;
  grossSellUsdt: number;
  spentRebuyUsdt: number;
  estimatedFeesUsdt: number;
  harvestedUsdt?: number;
  openedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface CycleMetrics {
  openCount: number;
  completedCount: number;
  completionRate: number;
  unrecoveredZig: number;
  avgSellPrice: number;
  avgRebuyPrice: number | null;
  harvestedUsdt: number;        // from COMPLETED cycles only
  outstandingSellUsdt: number;  // proceeds tied up in open sells
  opportunityCostUsdt: number | null; // unrecovered × (mark − avgSellPrice); +ve = bought-back-cheaper would cost more
}

const EPS = 1e-9;

// Geometric price bucket id: prices within the same BPS-wide band map to the same
// integer, independent of trade history. Stable across market regimes.
export function priceBucketId(price: number, bps: number): number {
  return Math.floor(Math.log(price) / Math.log(1 + bps / 10_000));
}

export class CycleTracker {
  private readonly cycles: HarvestCycle[] = [];
  private seq = 0;

  constructor(
    private readonly runId: string,
    private readonly exchange: Exchange,
    private readonly symbol: string,
    private readonly rebuyDistanceBps: number
  ) {}

  // A SELL fill opens a new cycle with a rebuy target below the sell price.
  onSell(fillId: string, qty: number, price: number, feeUsdt: number): HarvestCycle {
    const now = Date.now();
    const cycle: HarvestCycle = {
      cycleId: `${this.runId}-c${++this.seq}`,
      runId: this.runId,
      exchange: this.exchange,
      symbol: this.symbol,
      status: "OPEN",
      sellFillIds: [fillId],
      buyFillIds: [],
      soldQty: qty,
      reboughtQty: 0,
      unrecoveredQty: qty,
      avgSellPrice: price,
      rebuyTargetPrice: price * (1 - this.rebuyDistanceBps / 10_000),
      grossSellUsdt: price * qty,
      spentRebuyUsdt: 0,
      estimatedFeesUsdt: feeUsdt,
      openedAt: now,
      updatedAt: now,
    };
    this.cycles.push(cycle);
    return cycle;
  }

  // A BUY fill recovers inventory: FIFO-match the oldest eligible open cycles.
  onBuy(fillId: string, qty: number, price: number, feeUsdt: number): void {
    let remaining = qty;
    const eligible = this.openCyclesForRebuy(price);
    const totalFeeBase = qty > 0 ? feeUsdt / qty : 0; // spread the buy fee across allocated qty

    for (const c of eligible) {
      if (remaining <= EPS) break;
      const alloc = Math.min(remaining, c.unrecoveredQty);
      if (alloc <= EPS) continue;

      c.reboughtQty += alloc;
      c.unrecoveredQty = Math.max(c.unrecoveredQty - alloc, 0);
      c.spentRebuyUsdt += alloc * price;
      c.estimatedFeesUsdt += alloc * totalFeeBase;
      c.avgRebuyPrice = c.spentRebuyUsdt / c.reboughtQty;
      if (!c.buyFillIds.includes(fillId)) c.buyFillIds.push(fillId);
      c.updatedAt = Date.now();

      if (c.unrecoveredQty <= EPS) {
        c.status = "COMPLETED";
        c.completedAt = Date.now();
        c.harvestedUsdt = c.grossSellUsdt - c.spentRebuyUsdt - c.estimatedFeesUsdt;
      } else {
        c.status = "PARTIALLY_REBOUGHT";
      }
      remaining -= alloc;
    }
  }

  unrecoveredTotal(): number {
    return this.cycles.reduce((s, c) => s + c.unrecoveredQty, 0);
  }

  // A price bucket is "occupied" while an OPEN cycle was sold in that bucket — so we
  // don't re-sell the same zone. It frees automatically when the cycle COMPLETES
  // (no longer open), which fixes the lastSellPrice trap: after a rebuy restores
  // inventory, a profitable sell in that zone is allowed again.
  sellBucketOccupied(price: number, bps: number): boolean {
    const b = priceBucketId(price, bps);
    return this.cycles.some((c) => c.status !== "COMPLETED" && priceBucketId(c.avgSellPrice, bps) === b);
  }

  // Open/partial cycles whose target the current ask has reached (price dropped
  // to/below target), oldest first — FIFO recovery.
  openCyclesForRebuy(ask: number): HarvestCycle[] {
    return this.cycles
      .filter((c) => c.unrecoveredQty > EPS && c.rebuyTargetPrice >= ask)
      .sort((a, b) => a.openedAt - b.openedAt);
  }

  all(): readonly HarvestCycle[] {
    return this.cycles;
  }

  metrics(mark: number | null): CycleMetrics {
    const completed = this.cycles.filter((c) => c.status === "COMPLETED");
    const open = this.cycles.filter((c) => c.status !== "COMPLETED");
    const soldQtyTotal = this.cycles.reduce((s, c) => s + c.soldQty, 0);
    const reboughtTotal = this.cycles.reduce((s, c) => s + c.reboughtQty, 0);
    const avgSellPrice =
      soldQtyTotal > 0 ? this.cycles.reduce((s, c) => s + c.avgSellPrice * c.soldQty, 0) / soldQtyTotal : 0;
    const avgRebuyPrice =
      reboughtTotal > 0 ? this.cycles.reduce((s, c) => s + (c.avgRebuyPrice ?? 0) * c.reboughtQty, 0) / reboughtTotal : null;
    const unrecoveredZig = this.unrecoveredTotal();
    const outstandingSellUsdt = this.cycles.reduce((s, c) => s + c.unrecoveredQty * c.avgSellPrice, 0);
    const harvestedUsdt = completed.reduce((s, c) => s + (c.harvestedUsdt ?? 0), 0);

    return {
      openCount: open.length,
      completedCount: completed.length,
      completionRate: this.cycles.length > 0 ? completed.length / this.cycles.length : 0,
      unrecoveredZig,
      avgSellPrice,
      avgRebuyPrice,
      harvestedUsdt,
      outstandingSellUsdt,
      opportunityCostUsdt: mark !== null ? unrecoveredZig * (mark - avgSellPrice) : null,
    };
  }
}
