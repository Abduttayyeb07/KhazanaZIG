# ZIG strategy simulation review - 5 September 2026

**Assessment: directionally aligned, but fix execution/accounting consistency before treating a deployed paper soak as meaningful validation. Profitability and ZIG compounding are not yet established.**

Starting capital per run: **6,000,000 ZIG (5,000,000 protected + 1,000,000 active) and 15,000 USDT**. These are virtual balances. No trades, deployment, or paper-soak start occurred.

## Recent results with the liquidity units emitted by the current live feed

| Period | Closed-cycle harvest, USDT | Cash change, USDT | ZIG change | Surplus ZIG | NAV vs holding, USDT |
|---|---:|---:|---:|---:|---:|
| Recent 7 days (2026-08-29 to 2026-09-05) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Recent 30 days (2026-08-06 to 2026-09-05) | 45.22 | 71.19 | -222.16 | 0.00 | 61.86 |
| Recent MEXC history (2026-08-15 to 2026-09-05) | 21.11 | 40.79 | -185.59 | 0.00 | 33.01 |

The MEXC replay covers **499 completed hourly candles (20 days, 19 hours)**, 15 August 2026 15:00 UTC to 5 September 2026 10:00 UTC. It ends with **15,040.79 USDT and 5,999,814.41 ZIG**. Two cycles closed; one remains open with 185.59 ZIG not yet rebought. Recorded fees were 0.77 USDT.

The last seven days had **no trades**: the entire hourly price range was below the $0.045 accumulation floor. Full treasury NAV still changed by **-10,614.00 USDT**, entirely due to the held ZIG price changing. An idle strategy does not remove market risk.

Cash growth is not all profit: it includes proceeds from ZIG still sold. Closed-cycle harvest, inventory recovery, total NAV change, and improvement over holding answer different questions.

## Paired historical-window sweep

100 overlapping windows of 7-30 days were sampled with a fixed seed from 9,620 closed Gate hourly candles, 31 July 2025 to 5 September 2026. Each window was run under both the original replay representation and the units used by the current live feed. These are 100 resampled market windows, not 200 independent histories. Earnings must not be summed across them.

| Metric | Original replay units | Current live-feed units |
|---|---:|---:|
| Median completed-cycle harvest (USDT) | 881.19 | 393.69 |
| Mean completed-cycle harvest (USDT) | 1,529.53 | 772.37 |
| Median NAV vs holding (USDT) | 0.00 | 48.11 |
| Worst NAV vs holding (USDT) | -3,761.29 | -3,184.01 |
| Best NAV vs holding (USDT) | 9,496.99 | 4,675.24 |
| Median net ZIG change | -214.90 | -179.34 |
| Median surplus ZIG | 0.00 | 0.00 |
| Worst full-treasury drawdown (%) | 46.65 | 47.24 |
| Windows outperforming holding | 49/100 | 56/100 |
| Windows with no trades / tied holding | 37/100 | 37/100 |

Current-feed-unit runs: **56 beat holding, 37 tied, 7 lagged**. Worst shortfall was **-3,184.01 USDT**. Lowest ZIG balance was **5,744,776.78**, above the 5 million floor; lowest cash was **14,530.65 USDT**. All 100 passed the instrumented invariants, with no early halts. This does **not** validate the missing daily-risk/freshness wiring.

**No accumulation occurred in any scenario.** In the base replay all regimes are HIGH/CHAOTIC, preventing accumulation. The snapshot-book sensitivity permits low volatility, but its depth still fails accumulation gates. No evidence of compounding extra ZIG was produced. One current-feed-unit window recorded **-423.87 USDT** completed-cycle harvest: the tracker allocates rebuys FIFO across all open cycles, rather than only those targeted by the order. This is a cycle-attribution issue to investigate before relying on that metric.

There were **57 fills after the zone changed to disallow a fresh order** across current-feed-unit windows. They are recorded as an operational gap, not hidden inside the passing invariant count.

## Selected market scenarios

These are diagnostic 30-day blocks selected by largest price rise, largest fall, or most closes inside the harvest band; they are not representative average-return examples.

| Scenario | Dates UTC | Closed harvest, USDT | NAV vs holding, USDT | Unrebought ZIG |
|---|---|---:|---:|---:|
| Largest rising 30-day block | 2026-04-27 to 2026-05-27 | 318.97 | 169.79 | 131,693.14 |
| Largest falling 30-day block | 2025-10-29 to 2025-11-28 | 4,750.78 | 4,753.32 | 76,422.26 |
| Most time in harvest band | 2025-11-28 to 2025-12-28 | 1,781.17 | 1,796.16 | 90,005.57 |

## Limits and what to fix next

These are historical-price scenario replays with modeled intrahour paths, spread, depth, and execution. They are not observed historical trades or estimates of what MEXC would actually have filled. Hourly completed volume scales modeled intrahour depth, introducing hindsight. All marketable orders can fill in full without queue reconstruction. Costs are 10 bps fee and 5 bps adverse slippage per fill, with a 75% fill probability per eligible tick, not per order. The current-book profile freezes one modern snapshot across history and is strictly a sensitivity, not historical liquidity evidence.

The original replay overstates liquidity relative to the current feed because of incompatible units. Merely converting units for this comparison does not repair production sizing. Accumulation cannot be assessed until liquidity/regime and fee-recovery issues are addressed.

Fix order: (1) liquidity units and fill-to-cycle attribution; (2) paper fill propagation into daily limits and elapsed-time stale-feed guards; (3) fee-inclusive affordability/principal recovery and dust handling; (4) capture real MEXC depth/ticks for a measured forward paper soak. Then add higher-band deployment/reserve-transfer policy, stronger signals, and the staged rebuy ladder.

The reserve preserves token quantity and long-term exposure; it does not preserve USDT value. The 47.24% worst drawdown above includes the whole ZIG treasury, including reserve.

See [implementation findings and code locations](REVIEW-NOTES.md) for the complete audit, strategic gaps, and sources.

## Validation and reproduction

- Backend typecheck passed.
- 53 paper-soak checks and 33 accumulation checks passed; risk-engine tests passed.
- New simulation checks passed for virtual calendar time, immediate-fill zone attribution, cash/inventory reconciliation, and restoration of the real clock on errors.
- All selected scenarios and paired windows passed the instrumented invariants. Unit tests do not close the integration gaps listed above.

Raw results: [full run results](strategy-review.json), [recent-week results](strategy-review-recent-week.json), [closed hourly input data](closed-hourly-inputs.json), [non-secret strategy settings](strategy-settings.json).

Input SHA-256: `d189bfe125c3a600be8e705ecc2a1c6a54d0cbef4539da7a33cb0ba8533c79a8`.

Run from the repository root:

```powershell
pnpm.cmd --filter @zig/core-engine exec tsx src/simulation/strategy-review.ts 100
pnpm.cmd --filter @zig/core-engine exec tsx src/simulation/simulation-audit.test.ts
```

The runner uses saved inputs; it does not fetch data or send orders. All starting capital, windows and fees are disclosed above. No runtime strategy parameters were optimized to improve these results.
