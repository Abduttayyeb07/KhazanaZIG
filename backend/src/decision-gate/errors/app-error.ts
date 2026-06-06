export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly severity: "INFO" | "WARN" | "CRITICAL",
    public readonly safeDetails?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}
