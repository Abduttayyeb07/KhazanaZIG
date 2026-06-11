import { createLogger } from "@zig/logger";
import type { ManagedOrder, OrderEvent } from "@zig/shared-types";
import type { SystemState } from "../state-engine/store.js";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline, PipelineDecision } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import { PaperEngine } from "../execution-engine/paper-engine.js";
import { CycleTracker, type HarvestCycle } from "./cycle-tracker.js";
import { HarvestDriver, type HarvestParams } from "./harvest-driver.js";
import type { VirtualAccount } from "./virtual-account.js";
import type { SoakReporter } from "./reporter.js";

const log = createLogger("soak-v2-test", "error");
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} (got ${got})`); }
}

// ── 1. Cycle tracker ────────────────────────────────────────────────────────────
{
  console.log("\n1. Cycle tracker (sell opens, buy FIFO-recovers, completes)");
  const t = new CycleTracker("run1", "bybit", "ZIGUSDT", 300); // 3% rebuy distance
  t.onSell("s1", 1000, 0.05, 0.5);
  ok("rebuy target = 0.0485", Math.abs(t.all()[0].rebuyTargetPrice - 0.0485) < 1e-9, t.all()[0].rebuyTargetPrice);
  ok("unrecovered = 1000", t.unrecoveredTotal() === 1000, t.unrecoveredTotal());
  ok("ask above target → not eligible", t.openCyclesForRebuy(0.049).length === 0);
  ok("ask at target → eligible", t.openCyclesForRebuy(0.0485).length === 1);

  t.onBuy("b1", 400, 0.048, 0.2);
  ok("partial: unrecovered = 600", Math.abs(t.unrecoveredTotal() - 600) < 1e-9, t.unrecoveredTotal());
  ok("status PARTIALLY_REBOUGHT", t.all()[0].status === "PARTIALLY_REBOUGHT", t.all()[0].status);

  t.onBuy("b2", 600, 0.048, 0.3);
  ok("complete: unrecovered = 0", t.unrecoveredTotal() === 0, t.unrecoveredTotal());
  ok("status COMPLETED", t.all()[0].status === "COMPLETED", t.all()[0].status);
  // harvested = gross(50) - spent(48) - fees(1.0) = 1.0
  ok("harvestedUsdt ≈ 1.0", Math.abs((t.all()[0].harvestedUsdt ?? 0) - 1.0) < 1e-6, t.all()[0].harvestedUsdt);

  const m = t.metrics(0.05);
  ok("metrics: 1 completed, 0 open, 100%", m.completedCount === 1 && m.openCount === 0 && m.completionRate === 1);
}

// ── 1b. Sell bucket occupancy (frees when the cycle completes) ──────────────────
{
  console.log("\n1b. Sell bucket occupancy (frees on cycle complete)");
  const t = new CycleTracker("rb", "bybit", "ZIGUSDT", 300);
  t.onSell("s", 1000, 0.052, 0.5);
  ok("occupied at sell zone", t.sellBucketOccupied(0.052, 25) === true);
  ok("not occupied at far zone", t.sellBucketOccupied(0.06, 25) === false);
  t.onBuy("b", 1000, 0.05, 0.5); // target 0.05044 >= ask 0.05 → recovers, completes
  ok("freed after cycle completes", t.sellBucketOccupied(0.052, 25) === false);
}

// ── 2. Paper realism (slippage + probabilistic fill) ────────────────────────────
{
  console.log("\n2. Paper realism (slippage + fill probability)");
  const events: OrderEvent[] = [];
  let rng = 0;
  const engine = new PaperEngine(
    (ev) => events.push(ev),
    () => ({ bestBid: 0.05, bestAsk: 0.051 }),
    log,
    { slippageBps: 5, fillProbability: 0.75, rng: () => rng }
  );
  const order = (id: string): ManagedOrder => ({
    clientOrderId: id, requestId: id, exchange: "bybit", symbol: "ZIGUSDT", side: "sell",
    price: 0.05, quantity: 100, filledQuantity: 0, status: "SUBMITTED", source: "PAPER_SIM",
    reason: "t", exchangeOrderId: null, paper: true, createdAt: Date.now(), updatedAt: Date.now(),
  });

  rng = 0; // < 0.75 → fills
  void engine.placeOrder(order("o1"));
  const fillEv = events.find((e) => e.type === "ORDER_FILLED");
  ok("filled when rng < prob", !!fillEv);
  ok("sell slippage applied (0.049975)", !!fillEv && Math.abs((fillEv.fillPrice ?? 0) - 0.049975) < 1e-9, fillEv?.fillPrice);

  events.length = 0;
  rng = 0.9; // >= 0.75 → skip fill, order rests
  void engine.placeOrder(order("o2"));
  ok("no fill when rng >= prob", !events.some((e) => e.type === "ORDER_FILLED"));
  rng = 0.1; engine.tick(); // now fills
  ok("fills on later tick when rng < prob", events.some((e) => e.type === "ORDER_FILLED"));
}

// ── 3. Driver discipline ────────────────────────────────────────────────────────
function makeState(bid: number, ask: number): SystemState {
  return {
    market: { bybit: { bestBid: bid, bestAsk: ask } as never, mexc: null },
    balances: { bybit: [], mexc: [] }, openOrders: { bybit: [], mexc: [] },
    fills: { bybit: [], mexc: [] }, lastReconciliation: { bybit: null, mexc: null },
    mode: "PAPER_MODE", recoveryComplete: true, lastStateUpdateAt: Date.now(),
  };
}
const baseParams: HarvestParams = {
  symbol: "ZIGUSDT", exchange: "bybit", minOrderZig: 100,
  maxOrderActivePct: 0.05, tickMs: 1000, sellCooldownMs: 0, buyCooldownMs: 0,
  sellBucketBps: 25, buyBucketBps: 25, rejectBackoffMs: 9_999_999, maxUnrecoveredActivePct: 0.25,
};
function harness(opts: {
  state: SystemState;
  accepted?: boolean;
  unrecovered?: number;
  rebuyCycles?: HarvestCycle[];
  params?: Partial<HarvestParams>;
  avgCost?: number;
  sellOccupied?: boolean;
  harvestSell?: boolean; // zone gate for sells (default true)
}) {
  const submits: { side: string; qty: number; price: number }[] = [];
  const blocked: string[] = [];
  const pipeline = { submit: async (r: { side: string; quantity: number; price: number }) => {
    submits.push({ side: r.side, qty: r.quantity, price: r.price });
    return { accepted: opts.accepted ?? true, ...(opts.accepted === false ? { stage: "ADAPTER", reason: "x" } : { clientOrderId: "c", order: {} }), risk: { decision: "ALLOW", requestedQty: r.quantity, approvedQty: r.quantity, reasons: [], severity: "INFO" } } as unknown as PipelineDecision;
  } } as unknown as ExecutionPipeline;
  const registry = { openOrders: () => [] } as unknown as OrderRegistry;
  const account = {
    avgCost: opts.avgCost ?? 0.05, activeZig: 1_000_000, usdtBalance: 15_000, startingActive: 1_000_000,
    unrecoveredZig: opts.unrecovered ?? 0,
    openCyclesForRebuy: () => opts.rebuyCycles ?? [],
    sellBucketOccupied: () => opts.sellOccupied ?? false,
  } as unknown as VirtualAccount;
  const reporter = { decision: () => {}, intentBlocked: (r: string) => blocked.push(r) } as unknown as SoakReporter;
  let state = opts.state;
  const stateEngine = { getState: () => state } as unknown as StateEngine;
  const zone = () => ({
    allowed: { harvestSell: opts.harvestSell ?? true, harvestRebuy: true, accumulationBuy: false, accumulationRecoverySell: false },
    aggression: "FULL" as const,
  });
  const driver = new HarvestDriver(stateEngine, pipeline, registry, account, reporter, { ...baseParams, ...opts.params }, zone, null, log);
  return { driver, submits, blocked, setState: (s: SystemState) => { state = s; } };
}

(async () => {
  console.log("\n3. Driver discipline");

  // Cooldown: bid above threshold (0.05×1.03=0.0515); 2 ticks → 1 sell (cooldown blocks 2nd)
  {
    const h = harness({ state: makeState(0.052, 0.0521), params: { sellCooldownMs: 9_999_999 } });
    await h.driver.tick(); await h.driver.tick();
    ok("cooldown: only 1 sell from 2 ticks", h.submits.length === 1, h.submits.length);
  }

  // Sell bucket occupancy: an OPEN cycle in this zone blocks re-selling it;
  // once it frees (not occupied) the zone is sellable again.
  {
    const occupied = harness({ state: makeState(0.052, 0.0521), sellOccupied: true });
    await occupied.driver.tick();
    ok("occupancy: occupied zone → no sell", occupied.submits.length === 0, occupied.submits.length);

    const free = harness({ state: makeState(0.052, 0.0521), sellOccupied: false });
    await free.driver.tick();
    ok("occupancy: free zone → sell", free.submits.length === 1, free.submits.length);
  }

  // Deployment cap: unrecovered at limit → no sell, blocked reason recorded
  {
    const h = harness({ state: makeState(0.052, 0.0521), unrecovered: 250_000 });
    await h.driver.tick();
    ok("deploy cap: no sell", h.submits.length === 0, h.submits.length);
    ok("deploy cap: reason recorded", h.blocked.includes("ACTIVE_DEPLOYMENT_CAP"));
  }

  // Reject backoff: reject sets backoff; same price blocked; price move clears
  {
    const h = harness({ state: makeState(0.052, 0.0521), accepted: false });
    await h.driver.tick();                                   // attempt 1 → rejected → backoff
    await h.driver.tick();                                   // same price → backoff blocks
    ok("backoff: 2nd attempt suppressed", h.submits.length === 1, h.submits.length);
    h.setState(makeState(0.0526, 0.0527));                   // big move clears backoff
    await h.driver.tick();
    ok("backoff: cleared by price move", h.submits.length === 2, h.submits.length);
  }

  // Cycle-bound buy: no open cycle → no buy; open cycle at target → buy
  // (sells suppressed via the zone gate so the rebuy path is exercised in isolation)
  {
    const noCycle = harness({ state: makeState(0.049, 0.048), harvestSell: false });
    await noCycle.driver.tick();
    ok("no cycle → no buy", noCycle.submits.length === 0, noCycle.submits.length);

    const cyc = { unrecoveredQty: 500 } as unknown as HarvestCycle;
    const withCycle = harness({ state: makeState(0.049, 0.048), rebuyCycles: [cyc], harvestSell: false });
    await withCycle.driver.tick();
    ok("open cycle at target → buy", withCycle.submits.length === 1 && withCycle.submits[0].side === "buy", JSON.stringify(withCycle.submits));
    ok("buy qty = unrecovered (500)", withCycle.submits[0]?.qty === 500, withCycle.submits[0]?.qty);
  }

  // Buy cooldown (per-bucket): same zone locked after a buy
  {
    const cyc = { unrecoveredQty: 500 } as unknown as HarvestCycle;
    const h = harness({ state: makeState(0.0479, 0.048), rebuyCycles: [cyc], params: { buyCooldownMs: 9_999_999 }, harvestSell: false });
    await h.driver.tick();                                   // buy zone 0.048 → locked
    await h.driver.tick();                                   // same zone → locked
    ok("buy cooldown: same bucket locked", h.submits.length === 1, h.submits.length);
  }

  // Buy bucket: a DIFFERENT zone (distinct cycle) is free to recover immediately
  {
    const cyc = { unrecoveredQty: 500 } as unknown as HarvestCycle;
    const h = harness({ state: makeState(0.0479, 0.048), rebuyCycles: [cyc], params: { buyCooldownMs: 9_999_999 }, harvestSell: false });
    await h.driver.tick();                                   // buy zone A (0.048)
    h.setState(makeState(0.0599, 0.06));                     // different bucket
    await h.driver.tick();
    ok("buy bucket: different zone allowed", h.submits.length === 2, h.submits.length);
  }

  // ── 3b. Rebuy beats sell — the June-10 zero-rebuy fix ─────────────────────────
  // The dip that makes a cycle rebuy-eligible is ALSO a fresh sell bucket. With
  // sells ENABLED, an eligible rebuy must still fire (close) instead of opening a
  // new sell. Pre-fix, sell-first/return sold into the dip and starved the rebuy.
  console.log("\n3b. Rebuy priority over sell (June-10 fix)");
  {
    const cyc = { unrecoveredQty: 500 } as unknown as HarvestCycle;
    const h = harness({ state: makeState(0.049, 0.048), rebuyCycles: [cyc], harvestSell: true });
    await h.driver.tick();
    ok("eligible rebuy wins over sell → BUY", h.submits.length === 1 && h.submits[0].side === "buy", JSON.stringify(h.submits));
    ok("no sell opened into the dip", !h.submits.some((s) => s.side === "sell"));
  }

  // When the rebuy is eligible but temporarily gated (buy bucket on cooldown), the
  // driver must HOLD the sell rather than sell into the rebuy zone.
  {
    const cyc = { unrecoveredQty: 500 } as unknown as HarvestCycle;
    const h = harness({ state: makeState(0.0479, 0.048), rebuyCycles: [cyc], params: { buyCooldownMs: 9_999_999 }, harvestSell: true });
    await h.driver.tick();                                   // rebuy fires, locks buy bucket
    await h.driver.tick();                                   // rebuy gated → must NOT sell into dip
    ok("rebuy gated → sell held, not opened", h.submits.length === 1 && h.submits[0].side === "buy", JSON.stringify(h.submits));
    ok("SELL_HELD_FOR_REBUY recorded", h.blocked.includes("SELL_HELD_FOR_REBUY"));
  }

  console.log(`\n══════ ${pass} passed, ${fail} failed ══════`);
  process.exit(fail === 0 ? 0 : 1);
})();
