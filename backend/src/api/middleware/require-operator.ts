import crypto from "crypto";

// ── Operator token verification ────────────────────────────────────────────────
//
// Control-plane authorization for /api/operator/* routes. This is NOT user auth —
// it is command authorization for a single-operator treasury system.
//
//   - Constant-time comparison (timingSafeEqual on SHA-256 digests) so an
//     attacker cannot infer the token by measuring response timing.
//   - Fail closed: if no OPERATOR_TOKEN is configured, ALL control routes are
//     denied. A misconfigured server must never accept control actions.
//   - The token is never logged, echoed, or returned in any response.
// ──────────────────────────────────────────────────────────────────────────────

export type OperatorCheck =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "missing" | "invalid" };

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both to fixed length first — timingSafeEqual requires equal-length
  // buffers and would otherwise leak length information.
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function verifyOperatorToken(
  configuredToken: string,
  providedToken: string | undefined
): OperatorCheck {
  if (!configuredToken) return { ok: false, reason: "not_configured" };
  if (!providedToken) return { ok: false, reason: "missing" };
  if (!constantTimeEquals(configuredToken, providedToken)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}
