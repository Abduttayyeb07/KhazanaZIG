import type { Exchange } from "@zig/shared-types";
import type { AccumulationCycle, AccumulationMetrics } from "./accumulation-types.js";
import { recoveryTargetPrice } from "./accumulation-recovery.js";

const EPS = 1e-9;

// Tracks accumulation cycles. SEPARATE from harvest cycles by design.
export class AccumulationCycleTracker {
  private readonly cycles: AccumulationCycle[] = [];
  private seq = 0;

  constructor(
    private readonly runId: string,
    private readonly exchange: Exchange,
    private readonly symbol: string,
    private readonly recoveryProfitBps: number,
    private readonly principalRecoveryPct: number
  ) {}

  // A BUY opens a new accumulation cycle with a recovery target above the buy.
  onBuy(fillId: string, qty: number, price: number, feeUsdt: number): AccumulationCycle {
    const now = Date.now();
    const c: AccumulationCycle = {
      cycleId: `${this.runId}-acc${++this.seq}`,
      runId: this.runId,
      exchange: this.exchange,
      symbol: this.symbol,
      status: "OPEN",
      buyFillIds: [fillId],
      recoverySellFillIds: [],
      boughtQty: qty,
      recoveredSellQty: 0,
      surplusZigQty: qty,
      avgBuyPrice: price,
      targetRecoveryPrice: recoveryTargetPrice(price, this.recoveryProfitBps),
      usdtSpent: qty * price,
      usdtRecovered: 0,
      feesUsdt: feeUsdt,
      openedAt: now,
      updatedAt: now,
    };
    this.cycles.push(c);
    return c;
  }

  // A RECOVERY SELL reclaims principal FIFO across eligible cycles; surplus ZIG is kept.
  onRecoverySell(fillId: string, qty: number, price: number, feeUsdt: number): void {
    let remainingQty = qty;
    const feePerQty = qty > 0 ? feeUsdt / qty : 0;
    for (const c of this.openForRecovery(price)) {
      if (remainingQty <= EPS) break;
      const principalNeed = Math.max(c.usdtSpent * this.principalRecoveryPct - c.usdtRecovered, 0);
      const qtyForPrincipal = principalNeed / price;
      const sellable = Math.min(c.boughtQty - c.recoveredSellQty, qtyForPrincipal); // never sell more than held / needed
      const alloc = Math.min(remainingQty, sellable);
      if (alloc <= EPS) continue;

      const prevSold = c.recoveredSellQty;
      c.recoveredSellQty += alloc;
      c.usdtRecovered += alloc * price;
      c.surplusZigQty = Math.max(c.boughtQty - c.recoveredSellQty, 0);
      c.avgRecoverySellPrice = ((c.avgRecoverySellPrice ?? 0) * prevSold + price * alloc) / c.recoveredSellQty;
      c.feesUsdt += feePerQty * alloc;
      if (!c.recoverySellFillIds.includes(fillId)) c.recoverySellFillIds.push(fillId);
      c.updatedAt = Date.now();

      if (c.usdtRecovered >= c.usdtSpent * this.principalRecoveryPct - EPS) {
        c.status = "PRINCIPAL_RECOVERED";
        c.completedAt = Date.now();
      } else {
        c.status = "PARTIALLY_RECOVERED";
      }
      remainingQty -= alloc;
    }
  }

  // Open/partial cycles whose recovery target the bid has reached, still owing principal.
  openForRecovery(bid: number): AccumulationCycle[] {
    return this.cycles
      .filter(
        (c) =>
          (c.status === "OPEN" || c.status === "PARTIALLY_RECOVERED") &&
          bid >= c.targetRecoveryPrice &&
          c.usdtRecovered < c.usdtSpent * this.principalRecoveryPct - EPS
      )
      .sort((a, b) => a.openedAt - b.openedAt);
  }

  all(): readonly AccumulationCycle[] {
    return this.cycles;
  }

  metrics(): AccumulationMetrics {
    const open = this.cycles.filter((c) => c.status === "OPEN" || c.status === "PARTIALLY_RECOVERED");
    const recovered = this.cycles.filter((c) => c.status === "PRINCIPAL_RECOVERED" || c.status === "COMPLETED");
    return {
      openCount: open.length,
      principalRecoveredCount: recovered.length,
      usdtDeployed: this.cycles.reduce((s, c) => s + c.usdtSpent, 0),
      usdtRecovered: this.cycles.reduce((s, c) => s + c.usdtRecovered, 0),
      surplusZig: recovered.reduce((s, c) => s + c.surplusZigQty, 0),
      openExposureUsdt: open.reduce((s, c) => s + Math.max(c.usdtSpent * this.principalRecoveryPct - c.usdtRecovered, 0), 0),
    };
  }
}
