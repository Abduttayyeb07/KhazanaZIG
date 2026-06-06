import type { Exchange } from "@zig/shared-types";
import type { Logger } from "@zig/logger";
import type { TradingSession } from "./trading-session.js";

// ── Credential Vault ───────────────────────────────────────────────────────────
//
// Phase 1: in-memory only. No persistence between restarts.
// Phase 2: AES-256-GCM encryption + encrypted blob stored in DB.
// Phase 3: AWS KMS key wrapping for production.
//
// The vault never holds plaintext keys in its own state.
// It receives them, immediately binds them to the session, and forgets them.
// ──────────────────────────────────────────────────────────────────────────────

export class CredentialVault {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log.child({ module: "credential-vault" });
  }

  // Accept user-submitted credentials and bind them to the session.
  // The strings are consumed here and go no further than the session object.
  bindToSession(
    session: TradingSession,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string
  ): void {
    if (!session.isActive()) {
      this.log.error({ sessionId: session.sessionId, exchange }, "Attempted to bind credentials to destroyed session");
      throw new Error("Session is not active");
    }

    session.bind(exchange, apiKey, apiSecret);

    // Log the event — NOT the key values
    this.log.info(
      { sessionId: session.sessionId, exchange, keyPrefix: apiKey.slice(0, 4) + "****" },
      "Credentials bound to session"
    );
  }

  destroySession(session: TradingSession): void {
    const { sessionId } = session;
    session.destroy();
    this.log.info({ sessionId }, "Session destroyed — credentials wiped from memory");
  }
}
