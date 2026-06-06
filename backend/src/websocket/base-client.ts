import WebSocket from "ws";
import { EventEmitter } from "events";
import type { Logger } from "@zig/logger";

export type WsConnectionState =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "DISCONNECTED";

// ── Sequence state machine ─────────────────────────────────────────────────────
//
// UNINITIALIZED  → no snapshot received yet; deltas are dropped
// IN_SYNC        → snapshot applied; deltas accepted if seq > lastSeq (monotonic)
// RESYNCING      → real gap detected; all deltas dropped until next snapshot
//
// Critical: snapshot→delta transitions are NOT required to be +1 consecutive.
// Bybit and most exchanges assign internal sequence numbers that can jump.
// The only invariant that matters: monotonic increase (seq > lastSeq).
// Strict +1 continuity is an incorrect assumption that causes reconnect loops.
// ──────────────────────────────────────────────────────────────────────────────
type SequenceState = "UNINITIALIZED" | "IN_SYNC" | "RESYNCING";

export interface BaseWebSocketConfig {
  name: string;
  url: string;
  heartbeatIntervalMs: number;
  pongTimeoutMs: number;
  staleThresholdMs: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
}

export abstract class BaseWebSocketClient extends EventEmitter {
  protected readonly cfg: BaseWebSocketConfig;
  protected readonly log: Logger;

  private ws: WebSocket | null = null;
  private state: WsConnectionState = "IDLE";
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private destroyed = false;

  protected lastSequence = 0;
  protected sequenceState: SequenceState = "UNINITIALIZED";

  constructor(cfg: BaseWebSocketConfig, log: Logger) {
    super();
    this.cfg = cfg;
    this.log = log.child({ ws: cfg.name });
  }

  get connectionState(): WsConnectionState {
    return this.state;
  }

  get lastMessageAge(): number {
    return this.lastMessageAt > 0 ? Date.now() - this.lastMessageAt : Infinity;
  }

  get isSequenceHealthy(): boolean {
    return this.sequenceState === "IN_SYNC";
  }

  connect(): void {
    if (this.destroyed) return;
    if (this.state === "CONNECTING" || this.state === "CONNECTED") return;
    this.transition("CONNECTING");
    this.openSocket();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    this.transition("DISCONNECTED");
    this.ws?.terminate();
    this.ws = null;
    this.log.info("WebSocket destroyed");
  }

  protected abstract getSubscribeMessages(): object[];
  protected abstract isPong(data: string): boolean;
  protected abstract getPingMessage(): object;
  protected abstract onMessage(data: string): void;

  // Override for exchanges that send binary frames (e.g. MEXC protobuf). Default: no-op.
  protected onBinaryMessage(_data: Buffer): void {}

  // ── Sequence state machine ─────────────────────────────────────────────────

  // Call this when a snapshot arrives. Resets the sequence baseline.
  // The snapshot and first delta are NOT expected to be consecutive.
  protected applySnapshotSequence(snapshotSeq: number): void {
    this.lastSequence = snapshotSeq;
    this.sequenceState = "IN_SYNC";
    this.log.debug({ snapshotSeq }, "Sequence anchor set from snapshot");
  }

  // Call this for each delta. Validates monotonic increase only — NOT strict +1.
  // Returns false if the delta should be dropped (not yet in sync, or duplicate).
  protected validateDeltaSequence(incoming: number): boolean {
    if (this.sequenceState === "UNINITIALIZED") {
      this.log.debug({ incoming }, "Delta dropped — awaiting first snapshot");
      return false;
    }

    if (this.sequenceState === "RESYNCING") {
      this.log.debug({ incoming }, "Delta dropped — resyncing, awaiting snapshot");
      return false;
    }

    // Duplicate or out-of-order — drop silently
    if (incoming <= this.lastSequence) {
      return false;
    }

    this.lastSequence = incoming;
    return true;
  }

  // Call this when a real gap is detected (e.g., detected by exchange-specific logic).
  // Stops accepting deltas until the next snapshot restores the baseline.
  protected markSequenceGap(detail: { expected?: number; got: number }): void {
    this.log.warn(detail, "[WARN] Sequence gap — entering RESYNCING state");
    this.sequenceState = "RESYNCING";
    this.emit("sequenceGap", detail);
    this.scheduleReconnect();
  }

  // ── WebSocket lifecycle ────────────────────────────────────────────────────

  private openSocket(): void {
    this.ws = new WebSocket(this.cfg.url);

    this.ws.on("open", () => {
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.transition("CONNECTED");
      this.log.info("WebSocket connected");

      for (const msg of this.getSubscribeMessages()) {
        this.send(msg);
      }

      this.startHeartbeat();
      this.startStaleTimer();
      this.emit("connected");
    });

    this.ws.on("message", (raw, isBinary) => {
      this.lastMessageAt = Date.now();
      this.resetStaleTimer();

      // Binary frames (e.g. MEXC protobuf market data) go to onBinaryMessage.
      // Text frames (control: ping/pong, subscription acks, JSON data) go to onMessage.
      if (isBinary) {
        try {
          this.onBinaryMessage(raw as Buffer);
        } catch (err) {
          this.log.error({ err }, "Error processing binary WebSocket message");
        }
        return;
      }

      const data = raw.toString();

      if (this.isPong(data)) {
        this.clearPongTimer();
        return;
      }

      try {
        this.onMessage(data);
      } catch (err) {
        this.log.error({ err }, "Error processing WebSocket message");
      }
    });

    this.ws.on("error", (err) => {
      this.log.warn({ err: err.message }, "WebSocket error");
    });

    this.ws.on("close", (code, reason) => {
      this.log.warn({ code, reason: reason.toString() }, "WebSocket closed");
      this.clearHeartbeat();
      this.clearStaleTimer();

      if (!this.destroyed && this.state !== "DISCONNECTED") {
        this.transition("RECONNECTING");
        this.scheduleReconnect();
      }

      this.emit("disconnected", { code, reason: reason.toString() });
    });
  }

  protected send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.send(this.getPingMessage());
      this.pongTimer = setTimeout(() => {
        this.log.warn("Pong timeout — forcing reconnect");
        this.emit("pongTimeout");
        this.ws?.terminate();
      }, this.cfg.pongTimeoutMs);
    }, this.cfg.heartbeatIntervalMs);
  }

  private startStaleTimer(): void {
    this.clearStaleTimer();
    this.staleTimer = setInterval(() => {
      const age = this.lastMessageAge;
      if (age > this.cfg.staleThresholdMs) {
        this.log.warn({ staleMs: age }, "[WARN] Orderbook stale — forcing reconnect");
        this.emit("staleStream", { staleMs: age });
        this.ws?.terminate();
      }
    }, 1_000);
  }

  private resetStaleTimer(): void {
    this.clearStaleTimer();
    this.startStaleTimer();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;

    const delay = Math.min(
      this.cfg.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts),
      this.cfg.reconnectMaxDelayMs
    );

    this.reconnectAttempts++;
    this.log.info({ attempt: this.reconnectAttempts, delayMs: delay }, "Scheduling reconnect");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        // Reset sequence state on reconnect — we must wait for a fresh snapshot
        this.lastSequence = 0;
        this.sequenceState = "UNINITIALIZED";
        this.openSocket();
      }
    }, delay);
  }

  private transition(next: WsConnectionState): void {
    const prev = this.state;
    this.state = next;
    this.emit("stateChange", { from: prev, to: next });
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimer();
  }

  private clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private clearStaleTimer(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    this.clearStaleTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
