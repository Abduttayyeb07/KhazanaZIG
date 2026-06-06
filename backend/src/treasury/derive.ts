import type { ExchangeFill, DerivedTreasury, DeriveTreasuryOptions } from "@zig/shared-types";

// ── Pure treasury derivation ───────────────────────────────────────────────────
//
// Given the full fill history (+ reserve floor + mark price), derive the complete
// financial state. PURE and DETERMINISTIC: same fills + floor → same result.
// This is the "treasury memory" — state is always reconstructable from fills alone.
//
// Cost basis: weighted average.
//   BUY  → increases held base; recomputes avg cost from quote spent.
//   SELL → realizes PnL = (sellPrice − avgCost) × size; avg cost unchanged.
//
// Fees are normalized to the quote asset:
//   fee in QUOTE → folded into cost (buys) / netted from proceeds (sells)
//   fee in BASE  → reduces base received (buys)
// ──────────────────────────────────────────────────────────────────────────────

export function deriveTreasury(
  fills: ExchangeFill[],
  opts: DeriveTreasuryOptions
): DerivedTreasury {
  const { baseAsset, quoteAsset, reserveFloor } = opts;
  const markPrice = opts.markPrice ?? null;

  // Chronological order is required for correct weighted-average cost basis.
  const ordered = [...fills].sort((a, b) => a.filledAt - b.filledAt);

  let qty = 0;            // base held
  let avgCost = 0;        // weighted-average acquisition price (quote per base)
  let realizedPnl = 0;    // cumulative harvested (quote)
  let totalFeesUsdt = 0;  // cumulative fees, normalized to quote
  let lastFillAt: number | null = null;

  for (const f of ordered) {
    lastFillAt = f.filledAt;

    const feeQuote =
      f.feeAsset === quoteAsset ? f.fee : f.feeAsset === baseAsset ? f.fee * f.price : 0;
    totalFeesUsdt += feeQuote;

    if (f.side === "buy") {
      const baseReceived = f.feeAsset === baseAsset ? f.size - f.fee : f.size;
      const quoteSpent = f.price * f.size + (f.feeAsset === quoteAsset ? f.fee : 0);
      const newQty = qty + baseReceived;
      // Weighted-average cost: (prior cost + new cost) / new quantity
      avgCost = newQty > 0 ? (qty * avgCost + quoteSpent) / newQty : 0;
      qty = newQty;
    } else {
      // SELL — realize against current average cost; avg cost stays the same.
      const feeOnSale = f.feeAsset === quoteAsset ? f.fee : f.feeAsset === baseAsset ? f.fee * f.price : 0;
      realizedPnl += (f.price - avgCost) * f.size - feeOnSale;
      qty -= f.size;
      if (qty < 0) qty = 0; // clamp; negative means missing buy history
      if (qty === 0) avgCost = 0;
    }
  }

  const totalBase = qty;
  const reserveBase = Math.min(totalBase, reserveFloor);
  const activeBase = Math.max(totalBase - reserveFloor, 0);

  const unrealizedPnlUsdt = markPrice !== null ? (markPrice - avgCost) * totalBase : null;
  const inventoryValueUsdt = markPrice !== null ? totalBase * markPrice : null;

  return {
    baseAsset,
    quoteAsset,
    reserveFloor,
    totalBase,
    activeBase,
    reserveBase,
    avgCost,
    realizedPnlUsdt: realizedPnl,
    totalFeesUsdt,
    markPrice,
    unrealizedPnlUsdt,
    inventoryValueUsdt,
    fillCount: ordered.length,
    lastFillAt,
    derivedAt: Date.now(),
  };
}
