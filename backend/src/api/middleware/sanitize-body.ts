import type { Exchange } from "@zig/shared-types";

// ── Request body sanitization ──────────────────────────────────────────────────
//
// Attackers attack parsers first. Validate strictly and reject anything that
// isn't exactly the expected shape. Applies to control-plane payloads.
// ──────────────────────────────────────────────────────────────────────────────

export const MAX_BODY_BYTES = 8 * 1024; // 8 KB — credentials are tiny; reject anything large

const KEY_CHARSET = /^[A-Za-z0-9_\-]+$/;
const KEY_MIN = 8;
const KEY_MAX = 256;
const LABEL_MAX = 64;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface CredentialInput {
  exchange: Exchange;
  apiKey: string;
  apiSecret: string;
  label: string;
}

export function validateCredentialBody(body: unknown): ValidationResult<CredentialInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  // exchange enum
  if (b.exchange !== "bybit" && b.exchange !== "mexc") {
    return { ok: false, error: "exchange must be 'bybit' or 'mexc'" };
  }

  // apiKey / apiSecret: required strings, bounded length, restricted charset
  for (const field of ["apiKey", "apiSecret"] as const) {
    const v = b[field];
    if (typeof v !== "string") return { ok: false, error: `${field} must be a string` };
    if (v.length < KEY_MIN || v.length > KEY_MAX) {
      return { ok: false, error: `${field} length must be ${KEY_MIN}-${KEY_MAX}` };
    }
    if (!KEY_CHARSET.test(v)) {
      return { ok: false, error: `${field} contains invalid characters` };
    }
  }

  // label: optional, bounded
  let label = "";
  if (b.label !== undefined) {
    if (typeof b.label !== "string" || b.label.length > LABEL_MAX) {
      return { ok: false, error: `label must be a string up to ${LABEL_MAX} chars` };
    }
    label = b.label;
  }

  return {
    ok: true,
    value: {
      exchange: b.exchange,
      apiKey: b.apiKey as string,
      apiSecret: b.apiSecret as string,
      label,
    },
  };
}

export function validateExchangeOnly(body: unknown): ValidationResult<{ exchange: Exchange }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (b.exchange !== "bybit" && b.exchange !== "mexc") {
    return { ok: false, error: "exchange must be 'bybit' or 'mexc'" };
  }
  return { ok: true, value: { exchange: b.exchange } };
}

export interface OrderInput {
  exchange: Exchange;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  reason: string;
}

function finitePositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function validateOrderBody(body: unknown): ValidationResult<OrderInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (b.exchange !== "bybit" && b.exchange !== "mexc") {
    return { ok: false, error: "exchange must be 'bybit' or 'mexc'" };
  }
  if (b.side !== "buy" && b.side !== "sell") {
    return { ok: false, error: "side must be 'buy' or 'sell'" };
  }
  if (!finitePositive(b.quantity)) {
    return { ok: false, error: "quantity must be a positive number" };
  }
  if (!finitePositive(b.price)) {
    return { ok: false, error: "price must be a positive number" };
  }

  let reason = "operator manual order";
  if (b.reason !== undefined) {
    if (typeof b.reason !== "string" || b.reason.length > 200) {
      return { ok: false, error: "reason must be a string up to 200 chars" };
    }
    reason = b.reason;
  }

  return { ok: true, value: { exchange: b.exchange, side: b.side, quantity: b.quantity, price: b.price, reason } };
}
