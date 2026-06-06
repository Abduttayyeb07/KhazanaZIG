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

  constructor(
    bybitWs: BybitWebSocketClient,
    mexcWs: MexcWebSocketClient,
    symbol: string,
    stateEngine: StateEngine,
    log: Logger
  ) {
    this.bybitWs = bybitWs;
    this.mexcWs = mexcWs;
    this.symbol = symbol;
    this.stateEngine = stateEngine;
    this.log = log.child({ module: "market-ingestion" });
  }

  start(): void {
    this.wireBybit();
    this.wireMexc();
    this.bybitWs.connect();
    this.mexcWs.connect();
    this.log.info("Market ingestion pipeline started");
  }

  stop(): void {
    this.bybitWs.destroy();
    this.mexcWs.destroy();
    this.log.info("Market ingestion pipeline stopped");
  }

  private wireBybit(): void {
    this.bybitWs.on("connected", () => {
      this.log.info("[INFO] Bybit WebSocket connected");
    });

    this.bybitWs.on("disconnected", ({ code, reason }: { code: number; reason: string }) => {
      this.log.warn({ code, reason }, "[WARN] Bybit WebSocket disconnected");
    });

    this.bybitWs.on("sequenceGap", (detail: { expected: number; got: number }) => {
      this.log.warn(detail, "[WARN] Bybit sequence gap — resetting orderbook");
      this.bybitOrderbook.reset();
    });

    this.bybitWs.on("staleStream", ({ staleMs }: { staleMs: number }) => {
      this.log.warn({ staleMs }, "[WARN] Bybit orderbook stale — forcing reconnect");
      this.bybitOrderbook.reset();
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
      this.log.info("[INFO] MEXC WebSocket connected");
    });

    this.mexcWs.on("disconnected", ({ code, reason }: { code: number; reason: string }) => {
      this.log.warn({ code, reason }, "[WARN] MEXC WebSocket disconnected");
    });

    this.mexcWs.on("sequenceGap", (detail: { got: number }) => {
      this.log.warn(detail, "[WARN] MEXC sequence gap — resetting orderbook");
      this.mexcOrderbook.reset();
    });

    this.mexcWs.on("staleStream", ({ staleMs }: { staleMs: number }) => {
      this.log.warn({ staleMs }, "[WARN] MEXC orderbook stale — forcing reconnect");
      this.mexcOrderbook.reset();
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
      this.stateEngine.dispatch({ type: "MARKET_STATE_UPDATED", exchange: "bybit", state, source: "market-ingestion" });
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
      this.stateEngine.dispatch({ type: "MARKET_STATE_UPDATED", exchange: "mexc", state, source: "market-ingestion" });
    }
  }
}
