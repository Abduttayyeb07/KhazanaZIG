import type { Logger } from "@zig/logger";
import { AppError } from "./app-error.js";

export function logAppError(log: Logger, err: unknown): void {
  if (err instanceof AppError) {
    log.warn({ code: err.code, severity: err.severity, details: err.safeDetails }, err.message);
    return;
  }
  log.error({ err }, "Unexpected application error");
}
