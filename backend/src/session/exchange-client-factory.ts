import type { Logger } from "@zig/logger";
import type { Exchange } from "@zig/shared-types";
import { BybitRestClient } from "../exchange/bybit/rest.js";
import { MexcRestClient } from "../exchange/mexc/rest.js";
import { BybitWebSocketClient } from "../exchange/bybit/websocket.js";
import { MexcWebSocketClient } from "../exchange/mexc/websocket.js";
import type { TradingSession } from "./trading-session.js";

// ── Exchange Client Factory ───────────────────────────────────────────────────
//
// The ONLY place in the system that reads credentials from a TradingSession.
// WebSocket clients are public (no credentials required).
// REST clients require an active session with valid credentials.
//
// Rule: credentials must not be stored on the returned client instances
// beyond what is minimally needed for signing. They are captured at
// construction time and held only by the client instance, which is
// itself scoped to the session lifetime.
// ──────────────────────────────────────────────────────────────────────────────

export class ExchangeClientFactory {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log.child({ module: "exchange-client-factory" });
  }

  // Public market data — no credentials required
  createBybitWebSocket(symbol: string): BybitWebSocketClient {
    return new BybitWebSocketClient(symbol, this.log);
  }

  createMexcWebSocket(symbol: string): MexcWebSocketClient {
    return new MexcWebSocketClient(symbol, this.log);
  }

  // Authenticated REST clients — require active session with credentials
  createBybitRest(session: TradingSession): BybitRestClient | null {
    return this.createAuthenticatedRest("bybit", session, (key, secret) =>
      new BybitRestClient(key, secret, this.log)
    );
  }

  createMexcRest(session: TradingSession): MexcRestClient | null {
    return this.createAuthenticatedRest("mexc", session, (key, secret) =>
      new MexcRestClient(key, secret, this.log)
    );
  }

  private createAuthenticatedRest<T>(
    exchange: Exchange,
    session: TradingSession,
    factory: (key: string, secret: string) => T
  ): T | null {
    if (!session.isActive()) {
      this.log.warn({ exchange }, "Cannot create REST client — session is not active");
      return null;
    }

    const creds = session._unsafeGetCredentials(exchange);
    if (!creds) {
      this.log.warn({ exchange, sessionId: session.sessionId }, "No credentials bound for exchange");
      return null;
    }

    this.log.info({ exchange, sessionId: session.sessionId }, "REST client created from session credentials");

    // Credentials are consumed here. The factory call extracts them into the
    // client instance. This factory no longer holds a reference to them.
    return factory(creds.apiKey, creds.apiSecret);
  }
}
