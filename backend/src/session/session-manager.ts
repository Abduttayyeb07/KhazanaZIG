import type { Logger } from "@zig/logger";
import type { Exchange } from "@zig/shared-types";
import { BybitRestClient } from "../exchange/bybit/rest.js";
import { MexcRestClient } from "../exchange/mexc/rest.js";
import { CredentialStore, type PlainCredentials } from "./credential-store.js";

// ── AuthenticatedExchangeClient ────────────────────────────────────────────────
//
// The ONLY object recovery/reconciliation/execution receive. It exposes
// authenticated REST clients but NOT raw keys, encryption, or session internals.
// When the session is destroyed, this object's clients are discarded.
// ──────────────────────────────────────────────────────────────────────────────
export interface AuthenticatedExchangeClient {
  readonly bybit: BybitRestClient | null;
  readonly mexc: MexcRestClient | null;
  has(exchange: Exchange): boolean;
}

export interface SessionStatus {
  active: boolean;
  exchanges: Exchange[];
  startedAt: number | null;
  ephemeralEncryption: boolean;
}

export class SessionManager {
  private readonly store: CredentialStore;
  private readonly log: Logger;
  private readonly ephemeralEncryption: boolean;

  private bybitClient: BybitRestClient | null = null;
  private mexcClient: MexcRestClient | null = null;
  private startedAt: number | null = null;

  constructor(store: CredentialStore, log: Logger, ephemeralEncryption: boolean) {
    this.store = store;
    this.log = log.child({ module: "session-manager" });
    this.ephemeralEncryption = ephemeralEncryption;
  }

  // Submit new credentials: encrypt + persist, then (re)establish the session.
  async submitCredentials(
    exchange: Exchange,
    creds: PlainCredentials,
    label = ""
  ): Promise<void> {
    await this.store.save(exchange, creds, label);
    await this.establishFromStore();
  }

  // Load all stored credentials, decrypt, and build authenticated clients.
  // Called on startup and after every credential submission.
  async establishFromStore(): Promise<AuthenticatedExchangeClient | null> {
    const bybitCreds = await this.store.load("bybit");
    const mexcCreds = await this.store.load("mexc");

    if (!bybitCreds && !mexcCreds) {
      this.log.info("No stored credentials — session not established");
      return null;
    }

    this.bybitClient = bybitCreds
      ? new BybitRestClient(bybitCreds.apiKey, bybitCreds.apiSecret, this.log)
      : null;
    this.mexcClient = mexcCreds
      ? new MexcRestClient(mexcCreds.apiKey, mexcCreds.apiSecret, this.log)
      : null;

    this.startedAt = Date.now();
    const exchanges: Exchange[] = [];
    if (this.bybitClient) exchanges.push("bybit");
    if (this.mexcClient) exchanges.push("mexc");

    this.log.info({ exchanges }, "Trading session established from stored credentials");
    return this.getAuthenticatedClient();
  }

  getAuthenticatedClient(): AuthenticatedExchangeClient | null {
    if (!this.bybitClient && !this.mexcClient) return null;
    const bybit = this.bybitClient;
    const mexc = this.mexcClient;
    return {
      bybit,
      mexc,
      has: (exchange: Exchange) => (exchange === "bybit" ? bybit !== null : mexc !== null),
    };
  }

  async removeCredentials(exchange: Exchange): Promise<void> {
    await this.store.remove(exchange);
    if (exchange === "bybit") this.bybitClient = null;
    else this.mexcClient = null;
  }

  destroy(): void {
    this.bybitClient = null;
    this.mexcClient = null;
    this.startedAt = null;
    this.log.info("Trading session destroyed — authenticated clients discarded");
  }

  async status(): Promise<SessionStatus> {
    const stored = await this.store.list();
    return {
      active: this.bybitClient !== null || this.mexcClient !== null,
      exchanges: stored.map((s) => s.exchange),
      startedAt: this.startedAt,
      ephemeralEncryption: this.ephemeralEncryption,
    };
  }
}
