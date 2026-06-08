// ── Accumulation recovery math (pure) ───────────────────────────────────────────

export function recoveryTargetPrice(avgBuyPrice: number, recoveryProfitBps: number): number {
  return avgBuyPrice * (1 + recoveryProfitBps / 10_000);
}

// Sell only enough ZIG at `bid` to reclaim the outstanding USDT principal.
export function recoverySellQty(
  usdtSpent: number,
  principalRecoveryPct: number,
  usdtRecovered: number,
  bid: number
): number {
  if (bid <= 0) return 0;
  const remaining = Math.max(usdtSpent * principalRecoveryPct - usdtRecovered, 0);
  return remaining / bid;
}
