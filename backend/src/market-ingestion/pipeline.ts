import type { Exchange } from "@zig/shared-types";
import type { Logger } from "@zig/logger";
import { OrderbookEngine } from "../orderbook/engine.js";
import { BybitWebSocketClient } from "../exchange/bybit/websocket.js";
import { MexcWebSocketClient } from "../exchange/mexc/websocket.js";
import { buildBybitNormalizedState } from "../exchange/bybit/normalizer.js";
import { buildMexcNormalizedState } from "../exchange/mexc/normalizer.js";
import type { BybitOrderbookMessage } from "../exchange/bybit/websocket.js";
import type { StateEngine } from "../state-engine/index.js";

interface MexcOrderbookMessage {
  data: { b: [string, string][]; a: [string, string][]; seq: number };
}
interface MexcDeltaMessage {
  d: { bids: [string, string][]; asks: [string, string][]; r: string };
}

export class MarketIngestionPipeline {
  private readonly bybitWs: BybitWebSocketClient;
  private readonly mexcWs: MexcWebSocketClient;
  private readonly bybitOrderbook = new OrderbookEngine();
  private readonly mexcOrderbook = new OrderbookEngine();
  private readonly stateEngine: StateEngine;
  private readonly symbol: string;
  private readonly log: Logger;

  private readonly connects: Record<Exchange, number[]> = { bybit: [], mexc: [] };
  private readonly connectedBefore: Record<Exchange, boolean> = { bybit: false, mexc: false };
  private readonly bybitEnabled: boolean;

  constructor(
    bybitWs: BybitWebSocketClient,
    mexcWs: MexcWebSocketClient,
    symbol: string,
    stateEngine: StateEngine,
    log: Logger,
    // Bybit is fully implemented and kept wired for a future multi-venue run, but
    // it is excluded from the running system by default (BYBIT_ENABLED=false):
    // the venue is geo-blocked from this deployment, so leaving it connected only
    // produces a permanently-DISCONNECTED card and reconnect noise in the feed.
    opts: { bybitEnabled?: boolean } = {}
  ) {
    this.bybitWs = bybitWs;
    this.mexcWs = mexcWs;
    this.symbol = symbol;
    this.stateEngine = stateEngine;
    this.bybitEnabled = opts.bybitEnabled ?? false;
    this.log = log.child({ module: "market-ingestion" });
  }

  start(): void {
    if (this.bybitEnabled) {
      this.wireBybit();
      this.bybitWs.connect();
    }
    this.wireMexc();
    this.mexcWs.connect();
    this.log.info({ bybit: this.bybitEnabled, mexc: true }, "Market ingestion pipeline started");
  }

  stop(): void {
    if (this.bybitEnabled) this.bybitWs.destroy();
    this.mexcWs.destroy();
    this.log.info("Market ingestion pipeline stopped");
  }

  private wireBybit(): void {
    this.bybitWs.on("connected", () => {
      if (this.connectedBefore.bybit) this.connects.bybit.push(Date.now());
      this.connectedBefore.bybit = true;
      this.connects.bybit = this.connects.bybit.filter(t => t >= Date.now() - 300_000);
      this.log.info("[INFO] Bybit WebSocket connected");
    });

    this.bybitWs.on("disconnected", ({ code, reason }: { code: number; reason: string }) => {
      this.invalidate("bybit");
      this.bybitOrderbook.reset();
      this.log.warn({ code, reason }, "[WARN] Bybit WebSocket disconnected");
    });

    this.bybitWs.on("sequenceGap", (detail: { expected: number; got: number }) => {
      this.log.warn(detail, "[WARN] Bybit sequence gap — resetting orderbook");
      this.bybitOrderbook.reset();
      this.invalidate("bybit");
    });

    this.bybitWs.on("staleStream", ({ staleMs }: { staleMs: number }) => {
      this.log.warn({ staleMs }, "[WARN] Bybit orderbook stale — forcing reconnect");
      this.bybitOrderbook.reset();
      this.invalidate("bybit");
    });

    this.bybitWs.on("orderbookSnapshot", (msg: BybitOrderbookMessage) => {
      this.bybitOrderbook.applySnapshot(msg.data.b, msg.data.a, msg.data.seq);
      this.publishBybitState();
    });

    this.bybitWs.on("orderbookDelta", (msg: BybitOrderbookMessage) => {
      this.bybitOrderbook.applyDelta(msg.data.b, msg.data.a, msg.data.seq);
      this.publishBybitState();
    });
  }

  private wireMexc(): void {
    this.mexcWs.on("connected", () => {
      if (this.connectedBefore.mexc) this.connects.mexc.push(Date.now());
      this.connectedBefore.mexc = true;
      this.connects.mexc = this.connects.mexc.filter(t => t >= Date.now() - 300_000);
      this.log.info("[INFO] MEXC WebSocket connected");
    });

    this.mexcWs.on("disconnected", ({ code, reason }: { code: number; reason: string }) => {
      this.invalidate("mexc");
      this.mexcOrderbook.reset();
      this.log.warn({ code, reason }, "[WARN] MEXC WebSocket disconnected");
    });

    this.mexcWs.on("sequenceGap", (detail: { got: number }) => {
      this.log.warn(detail, "[WARN] MEXC sequence gap — resetting orderbook");
      this.mexcOrderbook.reset();
      this.invalidate("mexc");
    });

    this.mexcWs.on("staleStream", ({ staleMs }: { staleMs: number }) => {
      this.log.warn({ staleMs }, "[WARN] MEXC orderbook stale — forcing reconnect");
      this.mexcOrderbook.reset();
      this.invalidate("mexc");
    });

    // REST seed + protobuf snapshot both arrive as orderbookSnapshot
    this.mexcWs.on("orderbookSnapshot", (msg: MexcOrderbookMessage) => {
      this.mexcOrderbook.applySnapshot(msg.data.b, msg.data.a, msg.data.seq);
      this.publishMexcState();
    });

    // Aggregated depth deltas (qty "0" removes a level — handled by OrderbookEngine)
    this.mexcWs.on("orderbookDelta", (msg: MexcDeltaMessage) => {
      const seq = parseInt(msg.d.r, 10);
      this.mexcOrderbook.applyDelta(msg.d.bids, msg.d.asks, seq);
      this.publishMexcState();
    });
  }

  private invalidate(exchange: Exchange): void {
    const state = this.stateEngine.getState().market[exchange];
    if (state) this.stateEngine.dispatch({ type: "MARKET_STATE_UPDATED", exchange,
      state: { ...state, websocketStatus: "RECONNECTING", sequenceStatus: "UNINITIALIZED" }, source: "market-ingestion" });
  }

  private publishBybitState(): void {
    const wsStatus = this.bybitWs.connectionState === "CONNECTED" ? "CONNECTED" : "RECONNECTING";
    const seqStatus = this.bybitWs.connectionState === "CONNECTED" ? "HEALTHY" : "UNINITIALIZED";

    const state = buildBybitNormalizedState(
      this.symbol,
      this.bybitOrderbook,
      wsStatus,
      seqStatus,
      this.bybitOrderbook.lastSequence
    );

    if (state) {
      this.stateEngine.dispatch({ type: "MARKET_STATE_UPDATED", exchange: "bybit", state: { ...state, reconnectTimestamps: [...this.connects.bybit] }, source: "market-ingestion" });
    }
  }

  private publishMexcState(): void {
    const wsStatus = this.mexcWs.connectionState === "CONNECTED" ? "CONNECTED" : "RECONNECTING";
    const seqStatus = this.mexcWs.connectionState === "CONNECTED" ? "HEALTHY" : "UNINITIALIZED";

    const state = buildMexcNormalizedState(
      this.symbol,
      this.mexcOrderbook,
      wsStatus,
      seqStatus,
      this.mexcOrderbook.lastSequence
    );

    if (state) {
      this.stateEngine.dispatch({ type: "MARKET_STATE_UPDATED", exchange: "mexc", state: { ...state, reconnectTimestamps: [...this.connects.mexc] }, source: "market-ingestion" });
    }
  }
}
