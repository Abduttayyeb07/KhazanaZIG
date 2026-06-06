import axios from "axios";

// Converts any thrown HTTP error into a clean Error that carries ONLY the
// status code and the exchange-provided message. Critically, it strips the
// axios `config` (which contains request headers including the API key/secret
// and the signed query string). Raw axios errors must NEVER be logged or
// propagated, or credentials leak into logs.
export function sanitizeHttpError(exchange: string, err: unknown): Error {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? "no-response";
    const data = err.response?.data as { msg?: string; retMsg?: string } | undefined;
    const msg = data?.msg ?? data?.retMsg ?? err.message ?? "request failed";
    // Build a fresh Error — do NOT attach the original error (it holds config/headers)
    return new Error(`${exchange} REST ${status}: ${msg}`);
  }
  if (err instanceof Error) {
    // Already-sanitized errors (e.g. retCode rejections) pass through by message only
    return new Error(`${exchange} REST: ${err.message}`);
  }
  return new Error(`${exchange} REST: unknown error`);
}
