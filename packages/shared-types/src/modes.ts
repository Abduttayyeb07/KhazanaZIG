export type OperationalMode =
  | "READ_ONLY"
  | "PAPER_MODE"
  | "NORMAL"
  | "DEFENSIVE"
  | "HALT";

export interface ModeTransition {
  from: OperationalMode;
  to: OperationalMode;
  reason: string;
  timestamp: number;
  triggeredBy: "system" | "operator" | "risk_engine";
}
