import type { Logger } from "@zig/logger";
import type { TelegramNotifier } from "../telegram/notifier.js";
import type { RiskDecision } from "../decision-gate/risk-types.js";
import type { VirtualAccount } from "./virtual-account.js";

// ── Soak reporter ───────────────────────────────────────────────────────────────
//
// "Decisions only" Telegram stream. Every message carries the running portfolio
// snapshot, so each push doubles as a state update — no separate summaries needed.
// ────────────────────────────────────────────────────────────────────────────────

export interface Intent {
  side: "buy" | "sell";
  quantity: number;
  price: number;
}

export class SoakReporter {
  private readonly tg: TelegramNotifier;
  private readonly account: VirtualAccount;
  private readonly markFn: () => number | null;
  private readonly log: Logger;

  constructor(tg: TelegramNotifier, account: VirtualAccount, markFn: () => number | null, log: Logger) {
    this.tg = tg;
    this.account = account;
    this.markFn = markFn;
    this.log = log.child({ module: "soak-reporter" });
  }

  startup(detail: Record<string, unknown>): void {
    this.tg.notify(
      `🧪 <b>PAPER SOAK STARTED</b>\n` +
      `Real market data · virtual money · real Phase 5 rules\n` +
      Object.entries(detail).map(([k, v]) => `${k}: <code>${String(v)}</code>`).join("\n") +
      `\n\n${this.snapshot()}`
    );
  }

  decision(intent: Intent, d: RiskDecision): void {
    const icon = d.decision === "ALLOW" ? "✅" : d.decision === "REDUCE" ? "✂️" : d.decision === "HALT" ? "🛑" : "⛔";
    const sideIcon = intent.side === "sell" ? "🔴 SELL" : "🟢 BUY";
    this.tg.notify(
      `${icon} <b>${d.decision}</b> — ${sideIcon}\n` +
      `Intent: <code>${fmt(intent.quantity)} ZIG @ ${intent.price}</code>\n` +
      `Approved: <code>${fmt(d.approvedQty)} ZIG</code>\n` +
      `Reasons: <code>${d.reasons.join(", ")}</code>\n\n` +
      this.snapshot()
    );
    this.log.info({ intent, decision: d.decision, approved: d.approvedQty, reasons: d.reasons }, "Soak decision");
  }

  fill(side: "buy" | "sell", size: number, price: number): void {
    const sideIcon = side === "sell" ? "🔴 SOLD" : "🟢 BOUGHT";
    this.tg.notify(
      `💱 <b>PAPER FILL</b> — ${sideIcon}\n` +
      `Filled: <code>${fmt(size)} ZIG @ ${price}</code>\n\n` +
      this.snapshot()
    );
    this.log.info({ side, size, price }, "Soak paper fill");
  }

  halt(reason: string): void {
    this.tg.notify(`🛑 <b>PAPER SOAK HALT</b>\n${reason}\n\n${this.snapshot()}`);
  }

  // On-demand snapshot for the /status command (returned, not pushed).
  statusText(): string {
    return this.snapshot();
  }

  // Portfolio snapshot appended to every message.
  private snapshot(): string {
    const mark = this.markFn();
    const t = this.account.derive(mark);
    const realized = t.realizedPnlUsdt;
    const unreal = t.unrealizedPnlUsdt;
    return (
      `📊 <b>Portfolio</b>\n` +
      `Total ZIG: <code>${fmt(t.totalBase)}</code> (active <code>${fmt(t.activeBase)}</code> / reserve <code>${fmt(t.reserveBase)}</code>)\n` +
      `USDT: <code>${fmt(this.account.usdtBalance)}</code>\n` +
      `Avg cost: <code>${t.avgCost.toFixed(6)}</code>` + (mark !== null ? ` · Mark: <code>${mark.toFixed(6)}</code>` : "") + `\n` +
      `Realized PnL: <code>${realized.toFixed(2)} USDT</code>\n` +
      (unreal !== null ? `Unrealized PnL: <code>${unreal.toFixed(2)} USDT</code>\n` : "") +
      `Fees: <code>${t.totalFeesUsdt.toFixed(2)} USDT</code> · Fills: <code>${t.fillCount}</code>`
    );
  }
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
