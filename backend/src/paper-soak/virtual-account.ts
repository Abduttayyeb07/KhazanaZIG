import type { Logger } from "@zig/logger";
import type { Exchange, ExchangeBalance, ExchangeFill, DerivedTreasury } from "@zig/shared-types";
import { deriveTreasury } from "../treasury/derive.js";
import type { StateEngine } from "../state-engine/index.js";

// ── Virtual account for the paper soak ──────────────────────────────────────────
//
// Holds fake ZIG + USDT balances and a PAPER-ONLY fill ledger. It mirrors the
// virtual balances into the state engine so the real Risk/Sizing engines see them,
// and tracks cost basis / realized PnL via the same pure deriveTreasury() the real
// treasury uses. NOTHING here touches the real treasury ledger or DB — it is fully
// disposable. The synthetic opening position exists solely to give the harvester a
// cost basis to trade against (this is the paper ledger, not the immutable one).
// ────────────────────────────────────────────────────────────────────────────────

export interface VirtualAccountOptions {
  exchange: Exchange;
  baseAsset: string;
  quoteAsset: string;
  reserveFloor: number;
  startZig: number;
  startUsdt: number;
  takerFeeBps: number;
}

export class VirtualAccount {
  private zig: number;
  private usdt: number;
  private readonly fills: ExchangeFill[] = [];
  private readonly opts: VirtualAccountOptions;
  private readonly log: Logger;

  constructor(opts: VirtualAccountOptions, log: Logger) {
    this.opts = opts;
    this.zig = opts.startZig;
    this.usdt = opts.startUsdt;
    this.log = log.child({ module: "virtual-account" });
  }

  // Seed the opening position (cost basis) and publish virtual balances to state.
  seed(stateEngine: StateEngine, entryCost: number): void {
    if (this.zig > 0 && entryCost > 0) {
      this.fills.push({
        exchange: this.opts.exchange,
        fillId: "PAPER-OPENING",
        orderId: "PAPER-OPENING",
        clientOrderId: "PAPER-OPENING",
        symbol: "",
        side: "buy",
        price: entryCost,
        size: this.zig,
        fee: 0,
        feeAsset: this.opts.quoteAsset,
        filledAt: Date.now(),
      });
    }
    this.publishBalances(stateEngine);
    this.log.info(
      { zig: this.zig, usdt: this.usdt, entryCost, reserveFloor: this.opts.reserveFloor, active: this.activeZig },
      "Virtual account seeded"
    );
  }

  get activeZig(): number {
    return Math.max(this.zig - this.opts.reserveFloor, 0);
  }
  get usdtBalance(): number {
    return this.usdt;
  }
  get avgCost(): number {
    return this.derive(null).avgCost;
  }

  derive(markPrice: number | null): DerivedTreasury {
    return deriveTreasury(this.fills, {
      baseAsset: this.opts.baseAsset,
      quoteAsset: this.opts.quoteAsset,
      reserveFloor: this.opts.reserveFloor,
      markPrice,
    });
  }

  // Apply a simulated paper fill: move virtual cash/inventory and record it for
  // cost-basis derivation. A synthetic taker fee makes paper PnL more honest.
  applyPaperFill(
    side: "buy" | "sell",
    size: number,
    price: number,
    at: number,
    stateEngine: StateEngine
  ): void {
    const feeUsdt = price * size * (this.opts.takerFeeBps / 10_000);
    if (side === "buy") {
      this.zig += size;
      this.usdt -= price * size + feeUsdt;
    } else {
      this.zig -= size;
      this.usdt += price * size - feeUsdt;
    }
    if (this.zig < 0) this.zig = 0;
    if (this.usdt < 0) this.usdt = 0;

    this.fills.push({
      exchange: this.opts.exchange,
      fillId: `PAPER-LEDGER-${at}-${Math.random().toString(36).slice(2, 8)}`,
      orderId: "PAPER",
      clientOrderId: "PAPER",
      symbol: "",
      side,
      price,
      size,
      fee: feeUsdt,
      feeAsset: this.opts.quoteAsset,
      filledAt: at,
    });
    this.publishBalances(stateEngine);
  }

  private publishBalances(stateEngine: StateEngine): void {
    const now = Date.now();
    const balances: ExchangeBalance[] = [
      { exchange: this.opts.exchange, asset: this.opts.baseAsset, available: this.zig, locked: 0, total: this.zig, fetchedAt: now },
      { exchange: this.opts.exchange, asset: this.opts.quoteAsset, available: this.usdt, locked: 0, total: this.usdt, fetchedAt: now },
    ];
    stateEngine.dispatch({ type: "BALANCES_UPDATED", exchange: this.opts.exchange, balances, source: "paper-soak" });
  }
}
