import type { Logger } from "@zig/logger";
import type { TelegramNotifier } from "../telegram/notifier.js";
import type { RiskDecision } from "../decision-gate/risk-types.js";
import type { VirtualAccount } from "./virtual-account.js";
import type { AccBuyInfo, AccRecoveryInfo } from "../accumulation/accumulation-engine.js";
import type { AccumulationMetrics } from "../accumulation/accumulation-types.js";

export interface ReporterProviders {
  runId: string;
  summaryMs: number;
  zoneLabel?: () => string | null;
  accMetrics?: () => AccumulationMetrics | null;
}

// ── Soak reporter (v2 — throttled) ──────────────────────────────────────────────
// v1 pushed every tiny fill → 1,856 messages. v2 AGGREGATES activity and flushes a
// summary every TG_FILL_SUMMARY_INTERVAL_SECONDS. Critical events (HALT) still go
// out immediately. /status and /cycles give on-demand snapshots with cycle metrics.
// ────────────────────────────────────────────────────────────────────────────────

export interface Intent {
  side: "buy" | "sell";
  quantity: number;
  price: number;
}

interface Window {
  allowed: number;
  reduced: number;
  rejected: number;
  filledSells: number;
  filledBuys: number;
  soldZig: number;
  reboughtZig: number;
  blocked: Map<string, number>;
}

function emptyWindow(): Window {
  return { allowed: 0, reduced: 0, rejected: 0, filledSells: 0, filledBuys: 0, soldZig: 0, reboughtZig: 0, blocked: new Map() };
}

export class SoakReporter {
  private readonly tg: TelegramNotifier;
  private readonly account: VirtualAccount;
  private readonly markFn: () => number | null;
  private readonly runId: string;
  private readonly summaryMs: number;
  private readonly log: Logger;
  private w = emptyWindow();      // current summary window (resets each flush)
  private cum = emptyWindow();    // cumulative over the whole run (for the run record)
  private cumAccBuys = 0;
  private cumAccRecoveries = 0;
  private startedAt = 0;
  private startSnapshot = "";
  private baselineNavUsdt: number | null = null;
  private baselineMark: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly zoneLabel?: () => string | null;
  private readonly accMetrics?: () => AccumulationMetrics | null;

  constructor(
    tg: TelegramNotifier,
    account: VirtualAccount,
    markFn: () => number | null,
    opts: ReporterProviders,
    log: Logger
  ) {
    this.tg = tg;
    this.account = account;
    this.markFn = markFn;
    this.runId = opts.runId;
    this.summaryMs = opts.summaryMs;
    this.zoneLabel = opts.zoneLabel;
    this.accMetrics = opts.accMetrics;
    this.log = log.child({ module: "soak-reporter" });
  }

  // Immediate accumulation alerts (separate from harvest fills).
  accBuy(info: AccBuyInfo): void {
    this.cumAccBuys++;
    this.tg.notify(
      `🟢 <b>PAPER ACCUMULATION BUY</b> <code>${this.runId}</code>\n` +
      `Bought: <code>${fmt(info.qty)} ZIG</code> @ <code>${info.price.toFixed(6)}</code>\n` +
      `USDT spent: <code>${info.usdtSpent.toFixed(2)}</code> · Fee: <code>${info.fee.toFixed(2)}</code>\n` +
      `Recovery target: <code>${info.recoveryTarget.toFixed(6)}</code>\n` +
      `Budget remaining: <code>${info.budgetRemaining.toFixed(2)}</code> USDT · Cycle <code>${info.cycleId}</code>`
    );
  }

  accRecovery(info: AccRecoveryInfo): void {
    this.cumAccRecoveries++;
    this.tg.notify(
      `🟣 <b>PAPER ACCUMULATION RECOVERY</b> <code>${this.runId}</code>\n` +
      `Recovery sell: <code>${fmt(info.qty)} ZIG</code> @ <code>${info.price.toFixed(6)}</code> · Fee: <code>${info.fee.toFixed(2)}</code>\n` +
      `(principal reclaimed FIFO; surplus ZIG retained)`
    );
  }

  start(): void {
    this.timer = setInterval(() => this.flush(), this.summaryMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();        // final window summary
    this.runComplete();  // full run record
  }

  startup(detail: Record<string, unknown>): void {
    this.startedAt = Date.now();
    this.captureBaselineNav();
    this.startSnapshot = this.snapshot();
    this.tg.notify(
      `🧪 <b>PAPER SOAK STARTED</b> <code>${this.runId}</code>\n` +
      `Real market data · virtual money · real Phase 5 rules\n` +
      Object.entries(detail).map(([k, v]) => `${k}: <code>${String(v)}</code>`).join("\n") +
      `\n\n${this.startSnapshot}`
    );
  }

  // Aggregated — not pushed immediately (except HALT). Counts feed both the
  // rolling window and the cumulative run record.
  decision(_intent: Intent, d: RiskDecision): void {
    if (d.decision === "HALT") {
      this.tg.notify(`🛑 <b>RISK HALT</b>\nReasons: <code>${d.reasons.join(", ")}</code>\n\n${this.snapshot()}`);
      return;
    }
    const k = d.decision === "ALLOW" ? "allowed" : d.decision === "REDUCE" ? "reduced" : "rejected";
    this.w[k]++; this.cum[k]++;
  }

  fill(side: "buy" | "sell", size: number, _price: number): void {
    if (side === "sell") { this.w.filledSells++; this.w.soldZig += size; this.cum.filledSells++; this.cum.soldZig += size; }
    else { this.w.filledBuys++; this.w.reboughtZig += size; this.cum.filledBuys++; this.cum.reboughtZig += size; }
  }

  intentBlocked(reason: string): void {
    this.w.blocked.set(reason, (this.w.blocked.get(reason) ?? 0) + 1);
    this.cum.blocked.set(reason, (this.cum.blocked.get(reason) ?? 0) + 1);
  }

  halt(reason: string): void {
    this.tg.notify(`🛑 <b>PAPER SOAK HALT</b>\n${reason}\n\n${this.snapshot()}`);
  }

  statusText(): string {
    return this.snapshot();
  }

  // Periodic activity summary; silent when nothing happened.
  private flush(): void {
    const w = this.w;
    const activity = w.allowed + w.reduced + w.rejected + w.filledSells + w.filledBuys + w.blocked.size;
    if (activity === 0) return;
    this.w = emptyWindow();

    const blocked = [...w.blocked.entries()].map(([r, n]) => `${r}×${n}`).join(", ") || "—";
    const mins = Math.round(this.summaryMs / 60_000);
    this.tg.notify(
      `📊 <b>PAPER SOAK SUMMARY — ${mins}m</b> <code>${this.runId}</code>\n` +
      `Fills: ${w.filledSells} sell / ${w.filledBuys} buy\n` +
      `Decisions: ${w.allowed} allowed · ${w.reduced} reduced · ${w.rejected} rejected\n` +
      `Blocked: ${blocked}\n` +
      `Sold: <code>${fmt(w.soldZig)}</code> · Rebought: <code>${fmt(w.reboughtZig)}</code> ZIG\n\n` +
      this.snapshot()
    );
    this.log.info({ ...w, blocked: Object.fromEntries(w.blocked) }, "Soak summary");
  }

  // Full run record on stop — comparable across soaks (Telegram + structured log).
  private runComplete(): void {
    if (this.startedAt === 0) return;
    const c = this.cum;
    const mins = Math.round((Date.now() - this.startedAt) / 60_000);
    const blocked = [...c.blocked.entries()].map(([r, n]) => `${r}×${n}`).join(", ") || "—";
    const cm = this.account.cycleMetrics(this.markFn());
    this.tg.notify(
      `🏁 <b>PAPER SOAK RUN COMPLETE</b> <code>${this.runId}</code>\n` +
      `Duration: ${mins}m\n` +
      `Fills: ${c.filledSells} sell / ${c.filledBuys} buy\n` +
      `Decisions: ${c.allowed} allowed · ${c.reduced} reduced · ${c.rejected} rejected\n` +
      `Blocked: ${blocked}\n` +
      `Sold: <code>${fmt(c.soldZig)}</code> · Rebought: <code>${fmt(c.reboughtZig)}</code> ZIG\n` +
      `Harvest cycles: <code>${cm.completedCount}</code> done / <code>${cm.openCount}</code> open (${(cm.completionRate * 100).toFixed(0)}%)\n` +
      `Harvested: <code>${cm.harvestedUsdt.toFixed(2)}</code> USDT · Unrecovered: <code>${fmt(cm.unrecoveredZig)}</code> ZIG\n` +
      `Accumulation: ${this.cumAccBuys} buys / ${this.cumAccRecoveries} recoveries\n\n` +
      `<b>START</b>\n${this.startSnapshot}\n\n<b>END</b>\n${this.snapshot()}`
    );
    const acc = this.accMetrics?.() ?? null;
    this.log.warn(
      { runId: this.runId, durationMin: mins, ...c, blocked: Object.fromEntries(c.blocked), cycles: cm, accBuys: this.cumAccBuys, accRecoveries: this.cumAccRecoveries, accumulation: acc },
      "PAPER_SOAK_RUN_RECORD"
    );
  }

  // Portfolio + zone + harvest + accumulation snapshot.
  private snapshot(): string {
    const mark = this.markFn();
    const t = this.account.derive(mark);
    const c = this.account.cycleMetrics(mark);
    const zone = this.zoneLabel?.() ?? null;
    const acc = this.accMetrics?.() ?? null;
    const navLine = this.navLine(mark, t.totalBase);
    return (
      (zone ? `🧭 <b>Zone:</b> <code>${zone}</code>\n` : "") +
      `📦 <b>Portfolio</b>\n` +
      `Total ZIG: <code>${fmt(t.totalBase)}</code> (active <code>${fmt(t.activeBase)}</code> / reserve <code>${fmt(t.reserveBase)}</code>)\n` +
      `USDT: <code>${fmt(this.account.usdtBalance)}</code>\n` +
      `Avg cost: <code>${t.avgCost.toFixed(6)}</code>` + (mark !== null ? ` · Mark: <code>${mark.toFixed(6)}</code>` : "") + `\n` +
      (navLine ? `${navLine}\n` : "") +
      `Realized PnL: <code>${t.realizedPnlUsdt.toFixed(2)}</code>` + (t.unrealizedPnlUsdt !== null ? ` · Unrealized: <code>${t.unrealizedPnlUsdt.toFixed(2)}</code>` : "") + ` USDT\n` +
      `Fees: <code>${t.totalFeesUsdt.toFixed(2)}</code> USDT\n` +
      `🔄 <b>Harvest</b> open <code>${c.openCount}</code> · done <code>${c.completedCount}</code> (${(c.completionRate * 100).toFixed(0)}%)\n` +
      `Unrecovered: <code>${fmt(c.unrecoveredZig)}</code> ZIG · Harvested: <code>${c.harvestedUsdt.toFixed(2)}</code> USDT` +
      (c.opportunityCostUsdt !== null ? ` · Opp.cost: <code>${c.opportunityCostUsdt.toFixed(2)}</code>` : "") +
      (acc
        ? `\n🟢 <b>Accumulation</b> open <code>${acc.openCount}</code> · recovered <code>${acc.principalRecoveredCount}</code>\n` +
          `Deployed: <code>${acc.usdtDeployed.toFixed(2)}</code> · Recovered: <code>${acc.usdtRecovered.toFixed(2)}</code> USDT · ` +
          `Surplus ZIG: <code>${fmt(acc.surplusZig)}</code> · Open exposure: <code>${acc.openExposureUsdt.toFixed(2)}</code> USDT`
        : "")
    );
  }

  private captureBaselineNav(): void {
    const mark = this.markFn();
    if (mark === null) return;
    const t = this.account.derive(mark);
    this.baselineMark = mark;
    this.baselineNavUsdt = t.totalBase * mark + this.account.usdtBalance;
  }

  private navLine(mark: number | null, totalBase: number): string | null {
    if (mark === null || this.baselineNavUsdt === null) return null;
    const current = totalBase * mark + this.account.usdtBalance;
    const delta = current - this.baselineNavUsdt;
    const sign = delta >= 0 ? "+" : "";
    const startMark = this.baselineMark !== null ? ` @ ${this.baselineMark.toFixed(6)}` : "";
    return `NAV: <code>${current.toFixed(2)} USDT</code> · Δ <code>${sign}${delta.toFixed(2)} USDT</code> vs start<code>${startMark}</code>`;
  }
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
