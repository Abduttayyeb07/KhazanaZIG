import type { MarketZone } from "../zone-manager/zone-types.js";

// ── Safety invariants ───────────────────────────────────────────────────────────
//
// These are the properties that must hold in EVERY simulated run, on EVERY tick.
// A breach is a hard failure, not a metric: these are the promises the treasury
// makes (reserve protected, dry powder protected, no phantom money) and the
// promises the zone policy makes (no selling in accumulation zones, nothing at all
// while chaotic). Profitability is reported separately — a profitable run that
// breaches an invariant is still a failed run.
// ──────────────────────────────────────────────────────────────────────────────

export interface InvariantBreach {
  code: string;
  detail: string;
  at: number;
  tick: number;
}

export interface InvariantInput {
  tick: number;
  at: number;
  zig: number;
  usdt: number;
  reserveFloor: number;
  minUsdtFloor: number;
  zone: MarketZone | null;
  // Fills executed on this tick. `submittedInZone` is the zone that was current when
  // the ORDER WAS DECIDED, which is what the policy actually gates — orders rest, so
  // the zone at fill time can differ. Judging a decision by the zone at fill time
  // would blame the engine for the market moving after a legal order was placed.
  fills: {
    side: "buy" | "sell";
    qty: number;
    price: number;
    kind: "harvest" | "accumulation";
    submittedInZone: MarketZone | null;
  }[];
  accumulationOutstandingUsdt: number;
  accumulationBudgetCap: number;
  startingUsdt: number;
}

export class InvariantChecker {
  readonly breaches: InvariantBreach[] = [];
  // Orders that were legal when decided but filled after the zone turned against
  // them. Reported, not failed — see the zone-flip note in check().
  zoneFlipFills = 0;
  zoneFlipQty = 0;
  private lastZig: number | null = null;

  check(i: InvariantInput): void {
    const fail = (code: string, detail: string) => {
      // One breach per code per run keeps a systematic failure from producing
      // hundreds of thousands of identical rows across a 10k sweep.
      if (!this.breaches.some((b) => b.code === code)) {
        this.breaches.push({ code, detail, at: i.at, tick: i.tick });
      }
    };

    // ── Treasury protection ─────────────────────────────────────────────────
    if (i.zig < 0) fail("NEGATIVE_ZIG", `zig=${i.zig}`);
    if (i.usdt < 0) fail("NEGATIVE_USDT", `usdt=${i.usdt}`);

    // The reserve floor is the whole point of the active/reserve split: holdings may
    // never be sold below it. Buys pushing ZIG up are always fine.
    if (i.zig < i.reserveFloor - 1e-6) {
      fail("RESERVE_FLOOR_BREACHED", `zig=${i.zig.toFixed(2)} < floor=${i.reserveFloor}`);
    }

    // Dry powder: accumulation must never spend the USDT floor away. Harvest rebuys
    // are allowed to dip into it (they are closing an obligation, not opening one),
    // so this only fails when an accumulation buy did it.
    if (i.usdt < i.minUsdtFloor - 1e-6 && i.fills.some((f) => f.kind === "accumulation" && f.side === "buy")) {
      fail("USDT_FLOOR_BREACHED_BY_ACCUMULATION", `usdt=${i.usdt.toFixed(2)} < floor=${i.minUsdtFloor}`);
    }

    // ── Zone policy is actually enforced (judged at DECISION time) ──────────
    for (const f of i.fills) {
      const z = f.submittedInZone;
      if (z === "CHAOTIC") {
        fail("DECIDED_WHILE_CHAOTIC", `${f.kind} ${f.side} ${f.qty.toFixed(0)} @ ${f.price.toFixed(6)}`);
      }
      if (z === "ZONE_A_DEFENSIVE_ACCUMULATION" && f.side === "sell" && f.kind === "harvest") {
        fail("HARVEST_SELL_DECIDED_IN_ZONE_A", `sold ${f.qty.toFixed(0)} @ ${f.price.toFixed(6)}`);
      }
      if (z === "BELOW_ACTIVE_BAND" && f.side === "sell" && f.kind === "harvest") {
        fail("HARVEST_SELL_DECIDED_BELOW_BAND", `sold ${f.qty.toFixed(0)} @ ${f.price.toFixed(6)}`);
      }
      if (z === "BELOW_ACTIVE_BAND" && f.side === "buy" && f.kind === "accumulation") {
        fail("ACCUMULATION_BUY_DECIDED_BELOW_BAND", `bought ${f.qty.toFixed(0)} @ ${f.price.toFixed(6)}`);
      }
      if (!Number.isFinite(f.qty) || f.qty <= 0) fail("NON_POSITIVE_FILL", `${f.kind} ${f.side} qty=${f.qty}`);
      if (!Number.isFinite(f.price) || f.price <= 0) fail("NON_POSITIVE_PRICE", `${f.kind} ${f.side} price=${f.price}`);

      // Not a failure — a measured gap. The order was legal when placed, but the zone
      // flipped while it rested and nothing withdrew it. Counted so the size of the
      // exposure is visible rather than hidden inside a pass.
      if (z !== null && i.zone !== null && z !== i.zone) {
        const nowDisallows =
          i.zone === "CHAOTIC" ||
          (f.side === "sell" && f.kind === "harvest" &&
            (i.zone === "ZONE_A_DEFENSIVE_ACCUMULATION" || i.zone === "BELOW_ACTIVE_BAND"));
        if (nowDisallows) {
          this.zoneFlipFills++;
          this.zoneFlipQty += f.qty;
        }
      }
    }

    // ── Accumulation stays inside its allowance ─────────────────────────────
    if (i.accumulationOutstandingUsdt > i.accumulationBudgetCap + 1e-6) {
      fail(
        "ACCUMULATION_BUDGET_EXCEEDED",
        `outstanding=${i.accumulationOutstandingUsdt.toFixed(2)} > cap=${i.accumulationBudgetCap.toFixed(2)}`
      );
    }

    // ── No phantom inventory ────────────────────────────────────────────────
    // ZIG may only change when a fill happened this tick.
    if (this.lastZig !== null && Math.abs(i.zig - this.lastZig) > 1e-6 && i.fills.length === 0) {
      fail("ZIG_CHANGED_WITHOUT_FILL", `${this.lastZig.toFixed(4)} -> ${i.zig.toFixed(4)}`);
    }
    this.lastZig = i.zig;
  }

  get passed(): boolean {
    return this.breaches.length === 0;
  }
}
