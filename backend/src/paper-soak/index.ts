import type { Config } from "@zig/config";
import type { Logger } from "@zig/logger";
import type { Exchange, OrderEvent, ManagedOrder } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import type { ExecutionPipeline } from "../execution-engine/pipeline.js";
import type { OrderRegistry } from "../execution-engine/registry.js";
import type { TelegramNotifier } from "../telegram/notifier.js";
import { VirtualAccount } from "./virtual-account.js";
import { HarvestDriver } from "./harvest-driver.js";
import { SoakReporter } from "./reporter.js";

// ── Paper soak orchestrator ─────────────────────────────────────────────────────
//
// Stands up the virtual account, the harvest driver (intent generator), and the
// Telegram reporter. Live market data + virtual money + real Phase 5 rules.
//
// Runtime-adjustable knobs live in SoakSettings (set via Telegram /soak_set).
// RESERVE_FLOOR and the risk-band params are NOT here — they come from cfg so they
// always match the RiskEngine that actually enforces them (no desync footgun).
// ────────────────────────────────────────────────────────────────────────────────

export interface SoakSettings {
  exchange: Exchange;
  virtualZig: number;
  virtualUsdt: number;
  entryCost: number; // 0 = use market mid at boot
  tickSeconds: number;
  buySlicePct: number;
}

export function defaultSoakSettings(cfg: Config): SoakSettings {
  return {
    exchange: cfg.SOAK_EXCHANGE,
    virtualZig: cfg.SOAK_VIRTUAL_ZIG,
    virtualUsdt: cfg.SOAK_VIRTUAL_USDT,
    entryCost: cfg.SOAK_ENTRY_COST,
    tickSeconds: cfg.SOAK_TICK_SECONDS,
    buySlicePct: cfg.SOAK_BUY_SLICE_PCT,
  };
}

export interface PaperSoakDeps {
  cfg: Config;
  settings: SoakSettings;
  stateEngine: StateEngine;
  pipeline: ExecutionPipeline;
  registry: OrderRegistry;
  tg: TelegramNotifier;
  markFn: () => number | null;
  log: Logger;
}

export class PaperSoak {
  private readonly account: VirtualAccount;
  private readonly reporter: SoakReporter;
  private readonly driver: HarvestDriver;
  private readonly d: PaperSoakDeps;

  constructor(deps: PaperSoakDeps) {
    this.d = deps;
    const { cfg, settings, log, tg, markFn } = deps;

    this.account = new VirtualAccount(
      {
        exchange: settings.exchange,
        baseAsset: cfg.BASE_ASSET,
        quoteAsset: cfg.QUOTE_ASSET,
        reserveFloor: cfg.RESERVE_FLOOR,
        startZig: settings.virtualZig,
        startUsdt: settings.virtualUsdt,
        takerFeeBps: cfg.SOAK_TAKER_FEE_BPS,
      },
      log
    );
    this.reporter = new SoakReporter(tg, this.account, markFn, log);
    this.driver = new HarvestDriver(
      deps.stateEngine,
      deps.pipeline,
      deps.registry,
      this.account,
      this.reporter,
      {
        symbol: cfg.TRADING_SYMBOL,
        exchange: settings.exchange,
        minSellProfitBps: cfg.MIN_SELL_PROFIT_BPS,
        minRebuyDistanceBps: cfg.MIN_REBUY_DISTANCE_BPS,
        minOrderZig: cfg.MIN_ORDER_ZIG,
        maxOrderActivePct: cfg.MAX_ORDER_ACTIVE_PCT,
        buySlicePct: settings.buySlicePct,
        tickMs: settings.tickSeconds * 1_000,
      },
      log
    );
  }

  async start(): Promise<void> {
    const { cfg, settings, stateEngine, log } = this.d;

    // Resolve the opening cost basis: explicit setting, else market mid at boot.
    let entryCost = settings.entryCost;
    if (entryCost <= 0) {
      entryCost = (await this.waitForMid(30_000)) ?? 0;
      if (entryCost <= 0) {
        log.warn("Paper soak: no market mid available — opening cost basis is 0 (harvester idle until a buy establishes cost)");
      }
    }

    this.account.seed(stateEngine, entryCost);
    this.reporter.startup({
      Exchange: settings.exchange,
      "Virtual ZIG": settings.virtualZig,
      "Reserve floor": cfg.RESERVE_FLOOR,
      "Virtual USDT": settings.virtualUsdt,
      "Entry cost": entryCost,
      "Tick (s)": settings.tickSeconds,
    });
    this.driver.start();
    log.warn({ exchange: settings.exchange }, "PAPER SOAK RUNNING — virtual money, real rules");
  }

  stop(): void {
    this.driver.stop();
  }

  statusText(): string {
    return this.reporter.statusText();
  }

  fillsText(limit = 10): string {
    const fills = this.account.recentFills(limit);
    if (fills.length === 0) return "No paper fills recorded yet.";

    return (
      `<b>Recent paper fills</b>\n` +
      fills
        .map((f) => {
          const at = new Date(f.filledAt).toISOString();
          const notional = f.price * f.size;
          return (
            `${at}\n` +
            `<code>${f.side.toUpperCase()}</code> <code>${fmt(f.size)} ZIG</code> @ <code>${f.price.toFixed(6)}</code>\n` +
            `notional <code>${notional.toFixed(2)} USDT</code> fee <code>${f.fee.toFixed(2)} ${f.feeAsset}</code>\n` +
            `<code>${f.fillId}</code>`
          );
        })
        .join("\n\n")
    );
  }

  // Called from main's registry "fill" handler for PAPER- fills only.
  onPaperFill(ev: OrderEvent, order: ManagedOrder): void {
    if (order.exchange !== this.d.settings.exchange) return;
    const size = ev.fillQuantity ?? 0;
    const price = ev.fillPrice ?? order.price;
    if (size <= 0) return;
    this.account.applyPaperFill(order.side, size, price, ev.at, this.d.stateEngine);
    this.reporter.fill(order.side, size, price);
  }

  private async waitForMid(timeoutMs: number): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const mid = this.d.markFn();
      if (mid !== null && mid > 0) return mid;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    return this.d.markFn();
  }
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
