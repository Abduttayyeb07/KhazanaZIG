import { createLogger } from "@zig/logger";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import { AccumulationCycleTracker } from "./accumulation-cycle-tracker.js";
import { AccumulationBudget } from "./accumulation-budget.js";
import { recoveryTargetPrice, recoverySellQty } from "./accumulation-recovery.js";
import { AccumulationEngine, type AccTickContext, type AccumulationParams, type AccReporter } from "./accumulation-engine.js";
import type { AllowedActions } from "../zone-manager/zone-types.js";

const log = createLogger("acc-test", "error");
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} (got ${got})`); }
}

// ── 1. Recovery math + cycle tracker ────────────────────────────────────────────
console.log("\n1. Accumulation recovery + cycle tracker");
ok("recovery target = buy × 1.05", Math.abs(recoveryTargetPrice(0.049, 500) - 0.05145) < 1e-9, recoveryTargetPrice(0.049, 500));
ok("recovery sell qty = principal/bid", Math.abs(recoverySellQty(1000, 1.0, 0, 0.057) - 1000 / 0.057) < 1e-6);

{
  const t = new AccumulationCycleTracker("r", "bybit", "ZIGUSDT", 500, 1.0);
  const c = t.onBuy("b1", 20408, 0.049, 1.0);
  ok("cycle target 0.05145", Math.abs(c.targetRecoveryPrice - 0.05145) < 1e-9, c.targetRecoveryPrice);
  ok("usdtSpent ≈ 1000", Math.abs(c.usdtSpent - 20408 * 0.049) < 1e-6, c.usdtSpent);
  ok("below target → not eligible", t.openForRecovery(0.050).length === 0);
  ok("at/above target → eligible", t.openForRecovery(0.057).length === 1);

  const qty = recoverySellQty(c.usdtSpent, 1.0, 0, 0.057); // ~17543
  t.onRecoverySell("s1", qty, 0.057, 1.0);
  ok("status PRINCIPAL_RECOVERED", c.status === "PRINCIPAL_RECOVERED", c.status);
  ok("usdtRecovered ≈ principal", c.usdtRecovered >= c.usdtSpent - 1e-6, c.usdtRecovered);
  ok("surplus kept (~2865 ZIG)", Math.abs(c.surplusZigQty - (20408 - qty)) < 1e-6, c.surplusZigQty.toFixed(0));
}

// ── 2. Budget + dry powder ──────────────────────────────────────────────────────
console.log("\n2. Accumulation budget + dry powder");
{
  // start 15000 · budget 30%=4500 · daily 10%=1500 · total 50%=7500 · floor 5000
  const b = new AccumulationBudget(15000, 0.3, 0.1, 0.5, 5000);
  ok("daily cap binds (1500)", Math.abs(b.maxSpend(15000, 0) - 1500) < 1e-6, b.maxSpend(15000, 0));
  b.record(1500);
  ok("daily exhausted → 0", b.maxSpend(13500, 0) === 0, b.maxSpend(13500, 0));

  const b2 = new AccumulationBudget(15000, 0.3, 0.1, 0.5, 5000);
  ok("dry-powder floor binds (500)", Math.abs(b2.maxSpend(5500, 0) - 500) < 1e-6, b2.maxSpend(5500, 0));
  ok("at floor → 0", b2.maxSpend(5000, 0) === 0, b2.maxSpend(5000, 0));
  ok("harvest reserve reduces spend (1000)", Math.abs(b2.maxSpend(10000, 4000) - 1000) < 1e-6, b2.maxSpend(10000, 4000));
}

// ── 3. Accumulation engine gates ────────────────────────────────────────────────
console.log("\n3. Accumulation engine gates (all intents via pipeline)");
const params: AccumulationParams = {
  exchange: "bybit", symbol: "ZIGUSDT", enabled: true, recoveryEnabled: true, trancheUsdt: 1000,
  cooldownMs: 0, bucketBps: 100, minLiquidityUsdt: 5000, maxSpreadBps: 150, allowHighVol: false,
  allowChaotic: false, minUsdtFloor: 5000, principalRecoveryPct: 1.0, takerFeeBps: 10,
};
const allowAcc: AllowedActions = { harvestSell: false, harvestRebuy: false, accumulationBuy: true, accumulationRecoverySell: true };
function engine() {
  const submits: { side: string; qty: number; price: number }[] = [];
  const blocked: string[] = [];
  const pipeline = { submit: async (r: { side: string; quantity: number; price: number }) => {
    submits.push({ side: r.side, qty: r.quantity, price: r.price });
    return { accepted: true, clientOrderId: "c", order: {}, risk: { decision: "ALLOW", requestedQty: r.quantity, approvedQty: r.quantity, reasons: [], severity: "INFO" } } as never;
  } } as unknown as ExecutionPipeline;
  const reporter: AccReporter = { decision: () => {}, intentBlocked: (r) => blocked.push(r), accBuy: () => {}, accRecovery: () => {} };
  const tracker = new AccumulationCycleTracker("r", "bybit", "ZIGUSDT", 500, 1.0);
  const budget = new AccumulationBudget(15000, 0.3, 0.1, 0.5, 5000);
  const eng = new AccumulationEngine(pipeline, tracker, budget, reporter, params, log);
  return { eng, tracker, submits, blocked };
}
function ctx(over: Partial<AccTickContext> = {}): AccTickContext {
  return { bid: 0.049, ask: 0.0492, spreadBps: 40, liquidityUsdt: 50_000, regime: "NORMAL", allowed: allowAcc, usdtBalance: 15_000, harvestRebuyReserve: 0, now: Date.now(), ...over };
}

void (async () => {
  let h = engine();
  ok("zone allows → buy submitted", (await h.eng.attemptBuy(ctx())) && h.submits.length === 1 && h.submits[0].side === "buy", JSON.stringify(h.submits));

  h = engine();
  await h.eng.attemptBuy(ctx({ allowed: { ...allowAcc, accumulationBuy: false } }));
  ok("zone blocks acc-buy → no submit", h.submits.length === 0);

  h = engine();
  await h.eng.attemptBuy(ctx({ spreadBps: 200 }));
  ok("spread too wide → blocked", h.submits.length === 0 && h.blocked.includes("ACCUMULATION_SPREAD_TOO_WIDE"));

  h = engine();
  await h.eng.attemptBuy(ctx({ liquidityUsdt: 1000 }));
  ok("liquidity low → blocked", h.submits.length === 0 && h.blocked.includes("ACCUMULATION_LIQUIDITY_LOW"));

  h = engine();
  await h.eng.attemptBuy(ctx({ usdtBalance: 5000 }));
  ok("at dry-powder floor → blocked", h.submits.length === 0 && h.blocked.includes("USDT_RESERVE_FLOOR"));

  h = engine();
  await h.eng.attemptBuy(ctx({ regime: "CHAOTIC" }));
  ok("chaotic → no buy", h.submits.length === 0);

  // recovery: seed an open cycle, price above its target
  h = engine();
  h.tracker.onBuy("b", 20408, 0.049, 1.0); // target 0.05145
  ok("recovery sell when price ≥ target", (await h.eng.attemptRecoverySell(ctx({ bid: 0.052 }))) && h.submits.length === 1 && h.submits[0].side === "sell");

  h = engine();
  h.tracker.onBuy("b", 20408, 0.049, 1.0);
  ok("no recovery below target", !(await h.eng.attemptRecoverySell(ctx({ bid: 0.050 }))) && h.submits.length === 0);

  console.log(`\n══════ ${pass} passed, ${fail} failed ══════`);
  process.exit(fail === 0 ? 0 : 1);
})();
