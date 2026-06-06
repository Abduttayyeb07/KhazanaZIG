import pino from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type Logger = pino.Logger;

export function createLogger(name: string, level: LogLevel = "info"): Logger {
  return pino({
    name,
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label.toUpperCase() };
      },
    },
  });
}

export const logger = createLogger(
  "zig-treasury",
  (process.env["LOG_LEVEL"] as LogLevel | undefined) ?? "info"
);
