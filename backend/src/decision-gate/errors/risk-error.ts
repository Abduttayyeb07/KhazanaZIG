import { AppError } from "./app-error.js";

export class RiskError extends AppError {
  constructor(message: string, code: string, safeDetails?: Record<string, unknown>) {
    super(message, code, "WARN", safeDetails);
    this.name = "RiskError";
  }
}
