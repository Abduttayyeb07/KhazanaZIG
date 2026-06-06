import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@zig/logger";
import type { Exchange } from "@zig/shared-types";
import { CredentialCrypto } from "./crypto.js";

export interface PlainCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface StoredCredentialMeta {
  exchange: Exchange;
  label: string;
  updatedAt: number;
}

// ── CredentialStore ────────────────────────────────────────────────────────────
//
// The ONLY module that touches both encryption and the database for credentials.
// - save(): encrypt plaintext → persist ciphertext (raw keys never written)
// - load(): read ciphertext → decrypt → return plaintext (in-memory only)
// Plaintext never crosses this boundary in either direction except via the
// explicit save/load calls, and is never logged.
// ──────────────────────────────────────────────────────────────────────────────

export class CredentialStore {
  private readonly prisma: PrismaClient;
  private readonly crypto: CredentialCrypto;
  private readonly log: Logger;

  constructor(prisma: PrismaClient, crypto: CredentialCrypto, log: Logger) {
    this.prisma = prisma;
    this.crypto = crypto;
    this.log = log.child({ module: "credential-store" });
  }

  async save(exchange: Exchange, creds: PlainCredentials, label = ""): Promise<void> {
    const key = this.crypto.encrypt(creds.apiKey);
    const secret = this.crypto.encrypt(creds.apiSecret);

    await this.prisma.exchangeCredential.upsert({
      where: { exchange },
      create: {
        exchange,
        label,
        keyCiphertext: key.ciphertext,
        keyIv: key.iv,
        keyAuthTag: key.authTag,
        secretCiphertext: secret.ciphertext,
        secretIv: secret.iv,
        secretAuthTag: secret.authTag,
      },
      update: {
        label,
        keyCiphertext: key.ciphertext,
        keyIv: key.iv,
        keyAuthTag: key.authTag,
        secretCiphertext: secret.ciphertext,
        secretIv: secret.iv,
        secretAuthTag: secret.authTag,
      },
    });

    // Log the event, never the values
    this.log.info({ exchange, label, keyPrefix: creds.apiKey.slice(0, 4) + "****" }, "Credentials encrypted and stored");
  }

  async load(exchange: Exchange): Promise<PlainCredentials | null> {
    const row = await this.prisma.exchangeCredential.findUnique({ where: { exchange } });
    if (!row) return null;

    try {
      const apiKey = this.crypto.decrypt({
        ciphertext: row.keyCiphertext,
        iv: row.keyIv,
        authTag: row.keyAuthTag,
      });
      const apiSecret = this.crypto.decrypt({
        ciphertext: row.secretCiphertext,
        iv: row.secretIv,
        authTag: row.secretAuthTag,
      });
      return { apiKey, apiSecret };
    } catch (err) {
      // Decrypt failure = wrong/rotated ENCRYPTION_KEY or tampered blob
      this.log.error({ exchange, err }, "Credential decrypt failed — wrong ENCRYPTION_KEY or tampered data");
      return null;
    }
  }

  async list(): Promise<StoredCredentialMeta[]> {
    const rows = await this.prisma.exchangeCredential.findMany();
    return rows.map((r) => ({
      exchange: r.exchange as Exchange,
      label: r.label,
      updatedAt: r.updatedAt.getTime(),
    }));
  }

  async remove(exchange: Exchange): Promise<void> {
    await this.prisma.exchangeCredential.deleteMany({ where: { exchange } });
    this.log.info({ exchange }, "Stored credentials removed");
  }
}
