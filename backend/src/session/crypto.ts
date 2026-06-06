import crypto from "crypto";
import type { Logger } from "@zig/logger";

// ── AES-256-GCM credential encryption ──────────────────────────────────────────
//
// Encrypts user exchange credentials at rest. The master key is a SYSTEM secret
// (ENCRYPTION_KEY env var). GCM gives us authenticated encryption — any tampering
// with the stored ciphertext fails the auth tag check on decrypt.
//
// Storage format per encrypted value: { ciphertext, iv, authTag } all hex.
// ──────────────────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM

export interface EncryptedBlob {
  ciphertext: string; // hex
  iv: string; // hex
  authTag: string; // hex
}

export class CredentialCrypto {
  private readonly key: Buffer;
  private readonly ephemeral: boolean;

  constructor(hexKey: string, log: Logger) {
    const cryptoLog = log.child({ module: "credential-crypto" });

    if (hexKey && hexKey.length === 64) {
      this.key = Buffer.from(hexKey, "hex");
      this.ephemeral = false;
    } else {
      // Dev fallback — credentials encrypted with this won't decrypt after restart
      this.key = crypto.randomBytes(32);
      this.ephemeral = true;
      cryptoLog.warn(
        "ENCRYPTION_KEY not set — using ephemeral key. Stored credentials will NOT survive restart. Set ENCRYPTION_KEY for production."
      );
    }
  }

  get isEphemeral(): boolean {
    return this.ephemeral;
  }

  encrypt(plaintext: string): EncryptedBlob {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
    };
  }

  decrypt(blob: EncryptedBlob): string {
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, Buffer.from(blob.iv, "hex"));
    decipher.setAuthTag(Buffer.from(blob.authTag, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, "hex")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}
