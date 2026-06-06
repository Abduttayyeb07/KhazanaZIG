import axios from "axios";
import { BaseWebSocketClient } from "../../websocket/base-client.js";
import type { Logger } from "@zig/logger";
import { decodeMexcMessage } from "./protobuf.js";

// MEXC migrated to a protobuf WebSocket (Aug 2025). New endpoint + .pb channels.
const WS_URL = "wss://wbs-api.mexc.com/ws";

// Control messages (ping/pong, subscription acks) are JSON text.
// Market data (depth, deals) arrives as protobuf-encoded binary frames.

export type MexcTradeMessage = {
  symbol: string;
  deals: Array<{ price: string; quantity: string; tradeType: number; time: number }>;
};

interface MexcRestDepth {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export class MexcWebSocketClient extends BaseWebSocketClient {
  private readonly symbol: string;

  constructor(symbol: string, log: Logger) {
    super(
      {
        name: `mexc-ws-${symbol}`,
        url: WS_URL,
        heartbeatIntervalMs: 20_000,
        pongTimeoutMs: 5_000,
        staleThresholdMs: 40_000,
        reconnectBaseDelayMs: 1_000,
        reconnectMaxDelayMs: 30_000,
      },
      log
    );
    this.symbol = symbol;
  }

  // New protobuf channels — note the `.pb` suffix and 100ms aggregation interval.
  protected getSubscribeMessages(): object[] {
    return [
      { method: "SUBSCRIPTION", params: [`spot@public.aggre.depth.v3.api.pb@100ms@${this.symbol}`] },
      { method: "SUBSCRIPTION", params: [`spot@public.aggre.deals.v3.api.pb@100ms@${this.symbol}`] },
    ];
  }

  protected isPong(data: string): boolean {
    try {
      const msg = JSON.parse(data) as { msg?: string };
      return msg.msg === "PONG";
    } catch {
      return false;
    }
  }

  protected getPingMessage(): object {
    return { method: "PING" };
  }

  connect(): void {
    super.connect();
    // Seed the orderbook from public REST so we have data instantly,
    // before the first aggregated-depth delta arrives.
    this.seedFromRest();
  }

  private seedFromRest(): void {
    axios
      .get<MexcRestDepth>(
        `https://api.mexc.com/api/v3/depth?symbol=${this.symbol}&limit=20`,
        { timeout: 5_000 }
      )
      .then((res) => {
        const { lastUpdateId, bids, asks } = res.data;
        this.applySnapshotSequence(lastUpdateId);
        this.emit("orderbookSnapshot", { data: { b: bids, a: asks, seq: lastUpdateId } });
        this.log.info({ lastUpdateId }, "MEXC orderbook seeded from REST");
      })
      .catch((err: unknown) => {
        this.log.warn({ err }, "MEXC REST seed failed");
      });
  }

  // JSON text frames: subscription acks only (pong handled by base client)
  protected onMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as { code?: number; msg?: string };
      if (msg.code !== undefined && msg.code !== 0) {
        this.log.warn({ raw: data.slice(0, 200) }, "MEXC subscription rejected");
      } else if (msg.msg) {
        this.log.info({ ack: msg.msg }, "MEXC subscription ack");
      }
    } catch {
      // ignore non-JSON text
    }
  }

  // Binary frames: protobuf-encoded market data
  protected onBinaryMessage(data: Buffer): void {
    const decoded = decodeMexcMessage(data);
    if (!decoded) return;

    if (decoded.kind === "depth") {
      // Aggregated depth is incremental — apply as deltas on top of the REST seed.
      const seq = parseInt(decoded.toVersion, 10) || Date.now();
      const bids = decoded.bids.map((l) => [l.price, l.quantity] as [string, string]);
      const asks = decoded.asks.map((l) => [l.price, l.quantity] as [string, string]);

      if (this.sequenceState === "UNINITIALIZED") {
        this.applySnapshotSequence(seq);
        this.emit("orderbookSnapshot", { data: { b: bids, a: asks, seq } });
        return;
      }

      if (!this.validateDeltaSequence(seq)) return;
      this.emit("orderbookDelta", { d: { bids, asks, r: String(seq) } });
      return;
    }

    if (decoded.kind === "deals") {
      this.emit("trade", { symbol: decoded.symbol ?? this.symbol, deals: decoded.deals });
    }
  }
}
