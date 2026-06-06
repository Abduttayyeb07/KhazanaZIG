import type { Exchange } from "@zig/shared-types";

// Raw credentials live ONLY inside this object.
// They are never serialized, logged, or passed outside this module.
interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export type SessionStatus = "ACTIVE" | "DESTROYED";

export class TradingSession {
  readonly sessionId: string;
  readonly createdAt: number;

  private _status: SessionStatus = "ACTIVE";
  private _bybit: Credentials | null = null;
  private _mexc: Credentials | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.createdAt = Date.now();
  }

  get status(): SessionStatus {
    return this._status;
  }

  isActive(): boolean {
    return this._status === "ACTIVE";
  }

  hasCredentials(exchange: Exchange): boolean {
    if (!this.isActive()) return false;
    return exchange === "bybit" ? this._bybit !== null : this._mexc !== null;
  }

  bind(exchange: Exchange, apiKey: string, apiSecret: string): void {
    if (!this.isActive()) throw new Error("Cannot bind credentials to a destroyed session");
    if (exchange === "bybit") this._bybit = { apiKey, apiSecret };
    else this._mexc = { apiKey, apiSecret };
  }

  // Internal use only — only ExchangeClientFactory may call this.
  // The returned reference must not be stored outside the factory call.
  _unsafeGetCredentials(exchange: Exchange): Credentials | null {
    if (!this.isActive()) return null;
    return exchange === "bybit" ? this._bybit : this._mexc;
  }

  destroy(): void {
    // Best-effort wipe — null the references immediately.
    // Node.js GC will collect the string memory; no plaintext persists in the object.
    this._bybit = null;
    this._mexc = null;
    this._status = "DESTROYED";
  }
}
