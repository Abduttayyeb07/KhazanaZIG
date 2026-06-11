import type { Logger } from "@zig/logger";

// ── Control-plane audit log ────────────────────────────────────────────────────
//
// Every control action produces a structured, append-style audit record:
//   timestamp, action, source IP, success/failure, and safe context.
//
// HARD RULE: audit records NEVER contain secrets — no API keys, no tokens,
// no decrypted state. Only metadata about what was attempted and by whom.
// ──────────────────────────────────────────────────────────────────────────────

export type AuditAction =
  | "CREDENTIALS_SUBMIT"
  | "CREDENTIALS_DELETE"
  | "ORDER_PLACE"
  | "ORDER_CANCEL"
  | "APP_LOGIN"
  | "OPERATOR_AUTH_FAIL"
  | "RATE_LIMITED";

export interface AuditRecord {
  action: AuditAction;
  ip: string;
  success: boolean;
  exchange?: string;
  detail?: string;
}

export class AuditLog {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log.child({ module: "audit" });
  }

  record(rec: AuditRecord): void {
    this.log.warn(
      {
        audit: true,
        action: rec.action,
        ip: rec.ip,
        success: rec.success,
        exchange: rec.exchange,
        detail: rec.detail,
        at: new Date().toISOString(),
      },
      `AUDIT ${rec.action} ${rec.success ? "OK" : "DENIED"}`
    );
  }
}
