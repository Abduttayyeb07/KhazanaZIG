import { BaseWebSocketClient } from "../../websocket/base-client.js";
import type { Logger } from "@zig/logger";

const WS_URL = "wss://stream.bybit.com/v5/public/spot";

export type BybitOrderbookMessage = {
  type: "snapshot" | "delta";
  topic: string;
  ts: number;
  data: {
    s: string;
    b: [string, string][];
    a: [string, string][];
    u: number;
    seq: number;
  };
};

export type BybitTradeMessage = {
  topic: string;
  ts: number;
  type: "snapshot";
  data: Array<{
    T: number;
    s: string;
    S: string;
    v: string;
    p: string;
    i: string;
  }>;
};

export class BybitWebSocketClient extends BaseWebSocketClient {
  private readonly symbol: string;

  constructor(symbol: string, log: Logger) {
    super(
      {
        name: `bybit-ws-${symbol}`,
        url: WS_URL,
        heartbeatIntervalMs: 20_000,
        pongTimeoutMs: 5_000,
        staleThresholdMs: 30_000,  // must be > heartbeatIntervalMs so ping resets it first
        reconnectBaseDelayMs: 1_000,
        reconnectMaxDelayMs: 30_000,
      },
      log
    );
    this.symbol = symbol;
  }

  protected getSubscribeMessages(): object[] {
    return [
      {
        op: "subscribe",
        args: [`orderbook.50.${this.symbol}`, `publicTrade.${this.symbol}`],
      },
    ];
  }

  protected isPong(data: string): boolean {
    try {
      const msg = JSON.parse(data) as { op?: string; ret_msg?: string };
      return msg.op === "pong" || msg.ret_msg === "pong";
    } catch {
      return false;
    }
  }

  protected getPingMessage(): object {
    return { op: "ping" };
  }

  protected onMessage(data: string): void {
    const msg = JSON.parse(data) as { topic?: string; type?: string };
    if (!msg.topic) return;

    if (msg.topic.startsWith("orderbook.")) {
      const ob = msg as unknown as BybitOrderbookMessage;

      if (ob.type === "snapshot") {
        // Snapshot resets the sequence baseline.
        // The next delta's seq will NOT be snapshotSeq+1 — that is expected.
        this.applySnapshotSequence(ob.data.seq);
        this.emit("orderbookSnapshot", ob);
        return;
      }

      if (ob.type === "delta") {
        // Monotonic increase only — not strict +1.
        // If the state machine is UNINITIALIZED or RESYNCING, the delta is dropped.
        if (!this.validateDeltaSequence(ob.data.seq)) return;
        this.emit("orderbookDelta", ob);
        return;
      }
    }

    if (msg.topic.startsWith("publicTrade.")) {
      this.emit("trade", msg as unknown as BybitTradeMessage);
    }
  }
}
