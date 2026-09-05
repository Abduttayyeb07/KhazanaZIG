# Strategy implementation review

The architecture is a plausible treasury inventory-rotation prototype. It is not yet a validated source of repeatable profit, and the implementation does not yet cover the full strategy description.

## What already matches

- 6,000,000 virtual ZIG total; 5,000,000 protected; 1,000,000 active; 15,000 USDT.
- Zones A 0.045-0.05, B 0.05-0.06, C 0.06-0.075.
- Sell/rebuy cycle tracking with 3.5%, 5%, 6.5%, and 8% rebuy distances by regime.
- Rebuy priority, cooldowns, price buckets, inventory deployment limits, and reserve-floor checks.
- Completed harvest-cycle P&L deducts both transaction fees. USDT balance growth is separately measured because unrebought sales also increase cash.
- Paper-only automatic driver and explicit operator start. No live order path was invoked in this review.

## Correctness issues to resolve before a meaningful deployed paper soak

1. **Unify liquidity units.** `backend/src/orderbook/engine.ts` emits price-times-quantity depth in USDT. `decision-gate/risk-context.ts` and `paper-soak/harvest-driver.ts` treat it as ZIG and multiply by price again. The original replay supplies ZIG instead. This materially changes sizing and accumulation eligibility. The review compares both representations without changing production behavior.
2. **Wire paper fills into daily risk usage.** The virtual ledger updates balances, while risk-context computes daily usage from `state.fills`. The paper fill ledger is not propagated to that array. End-to-end daily limits therefore are not validated by the existing unit-test passes.
3. **Use elapsed market age and reconnect history.** Risk-context checks freshness stored at the last update and hardcodes reconnect count to zero. A silent stale feed needs an explicit elapsed-time guard.
4. **Make virtual accounting fail visibly.** VirtualAccount clamps negative balances to zero. The review now independently reconciles cash and inventory from every fill; production paper accounting should reject unaffordable orders including fees/slippage and surface an overdraw instead of hiding it.
5. **Recover accumulation principal after fees.** The accumulation tracker uses gross notionals for principal recovery and records fees separately. Minimum-order dust can strand incomplete recovery lots. Reported surplus is not proof that all costs were recovered.
6. **Preserve rebuy-to-cycle attribution.** The tracker allocates each rebuy FIFO over all open cycles, even when a different subset triggered the order. One reviewed window reported negative closed-cycle harvest despite the configured rebuy distances. Bind fills to the intended cycles before using cycle P&L to judge harvesting quality.
7. **Revalidate resting orders.** Orders can fill after the zone no longer permits a fresh order. The engine has stale-order cancellation, but not immediate zone-change cancellation. The report counts these fills separately.

## Strategic features still missing or incomplete

- No automatic deployment of higher bands or controlled transfer from strategic reserve. Above-band policy continues reduced harvesting and raises a breakout flag.
- Volatility currently means spread buckets. The live path does not use the advertised ATR/price-return, momentum exhaustion, or mean-reversion estimates. Imbalance is displayed rather than used in decisions.
- Zone C reduces size; it does not implement distinct wider sell spacing. Rebuys are triggered/aggregated, not a staged ladder of resting rebuy orders.
- Selling an eligible unoccupied price bucket does not specifically require upward momentum or strength.
- No explicit exchange-level self-trade prevention is wired. One-order-at-a-time driver behavior is a narrower safeguard.
- Retained accumulation surplus remains active inventory; it is not automatically promoted into protected reserve.

## Simulation-only corrections made during this review

- Virtual time now advances both `Date.now()` and zero-argument `new Date()`, so calendar-day checks see the simulated date.
- Immediate fills retain their submission zone for invariant checks.
- Added independent cash/inventory reconciliation, fees, unrecovered inventory, drawdown, minimum balances, early-halt and processed-tick reporting.
- Excluded candles that were unfinished when fetched; validated chronological continuity.
- Added paired liquidity-unit and current-book sensitivities. These are diagnostic scenarios, not parameter optimization.

The production strategy, live configuration, risk gates, and paper-soak enable flag were not changed. Deployment was not performed.

## How to interpret the strategy

The system rotates directional ZIG exposure and benefits when sales are followed by sufficiently lower repurchases. A rally can leave sold ZIG unrecovered; a decline can reduce total treasury value even while closed cycles earn USDT. Protected token quantity does not protect the reserve's USDT value. A reserve that can reload active bands needs an explicit transfer budget and approval rule; it cannot simultaneously be an unconditional untouchable floor and an automatically spendable allocation.

## Evidence and sources

- Local implementation: orderbook/engine.ts, decision-gate/risk-context.ts, execution-engine/paper-engine.ts, paper-soak/virtual-account.ts, paper-soak/harvest-driver.ts, paper-soak/cycle-tracker.ts, accumulation/accumulation-cycle-tracker.ts, zone-manager/zone-policy.ts, simulation/market-replay.ts.
- [MEXC official spot API documentation](https://mexcdevelop.github.io/apidocs/spot_v3_en/): market-data endpoints. Raw fetched public responses and timestamps are retained alongside the report.
- [Gate official API documentation](https://www.gate.com/en-us/docs/developers/apiv4/): historical candlestick source.
- [NFA explanation of hypothetical-performance limitations](https://www.nfa.futures.org/rulebooksql/rules.aspx?RuleID=9025&Section=9): simulated fills can misrepresent liquidity/slippage and hindsight. This is background on simulation limitations, not a determination of regulatory applicability to this project.

Reproduction from the repository root:

```powershell
pnpm.cmd --filter @zig/core-engine exec tsx src/simulation/strategy-review.ts 100
pnpm.cmd --filter @zig/core-engine exec tsx src/simulation/simulation-audit.test.ts
```

The review command uses the saved raw responses under `artifacts/simulation` and the existing `backend/data/zig-1h.json`; it makes no network calls. Strategy settings are recorded in `strategy-settings.json`. Reproduction requires the same settings and inputs. Each bootstrap window resets the same opening capital. Windows overlap; summing their earnings or reading the fraction outperforming hold as a forecast would be incorrect.
