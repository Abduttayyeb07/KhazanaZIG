import axios from "axios";
import type { Logger } from "@zig/logger";
import { OrderbookEngine } from "../orderbook/engine.js";
import { buildMexcNormalizedState } from "../exchange/mexc/normalizer.js";
import type { StateEngine } from "../state-engine/index.js";

interface MexcRestDepth {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
  timestamp: number;
}

export class MexcRestPoller {
  private readonly symbol: string;
  private readonly orderbook: OrderbookEngine;
  private readonly stateEngine: StateEngine;
  private readonly log: Logger;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private lastUpdateId = 0;

  constructor(
    symbol: string,
    orderbook: OrderbookEngine,
    stateEngine: StateEngine,
    log: Logger,
    intervalMs = 2_000
  ) {
    this.symbol = symbol;
    this.orderbook = orderbook;
    this.stateEngine = stateEngine;
    this.log = log.child({ module: "mexc-poller" });
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.poll().catch(() => undefined);
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        this.log.warn({ err }, "MEXC REST poll failed");
      });
    }, this.intervalMs);
    this.log.info({ intervalMs: this.intervalMs }, "MEXC REST poller started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    const res = await axios.get<MexcRestDepth>(
      `https://api.mexc.com/api/v3/depth?symbol=${this.symbol}&limit=20`,
      { timeout: 3_000 }
    );

    const { lastUpdateId, bids, asks } = res.data;

    // Only update if data changed
    if (lastUpdateId <= this.lastUpdateId) return;
    this.lastUpdateId = lastUpdateId;

    this.orderbook.applySnapshot(bids, asks, lastUpdateId);

    const state = buildMexcNormalizedState(
      this.symbol,
      this.orderbook,
      "CONNECTED",
      "HEALTHY",
      lastUpdateId
    );

    if (state) {
      this.stateEngine.dispatch({
        type: "MARKET_STATE_UPDATED",
        exchange: "mexc",
        state,
        source: "market-ingestion",
      });
    }
  }
}
