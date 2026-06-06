import { EventEmitter } from "events";
import type { Logger } from "@zig/logger";
import type { OperationalMode, ModeTransition } from "@zig/shared-types";

export class ModeManager extends EventEmitter {
  private current: OperationalMode;
  private readonly log: Logger;
  private history: ModeTransition[] = [];

  constructor(initial: OperationalMode, log: Logger) {
    super();
    this.current = initial;
    this.log = log.child({ module: "mode-manager" });
    this.log.info({ mode: initial }, "Operational mode initialized");
  }

  get mode(): OperationalMode {
    return this.current;
  }

  canExecute(): boolean {
    return this.current === "NORMAL" || this.current === "DEFENSIVE";
  }

  canPaperTrade(): boolean {
    return this.current === "PAPER_MODE";
  }

  isHalted(): boolean {
    return this.current === "HALT";
  }

  transition(
    to: OperationalMode,
    reason: string,
    triggeredBy: ModeTransition["triggeredBy"] = "system"
  ): void {
    if (this.current === to) return;

    const transition: ModeTransition = {
      from: this.current,
      to,
      reason,
      timestamp: Date.now(),
      triggeredBy,
    };

    this.log.warn(
      { from: transition.from, to: transition.to, reason, triggeredBy },
      "Operational mode transition"
    );

    this.current = to;
    this.history.push(transition);
    this.emit("modeChange", transition);
  }

  halt(reason: string, triggeredBy: ModeTransition["triggeredBy"] = "system"): void {
    this.transition("HALT", reason, triggeredBy);
  }

  getHistory(): ModeTransition[] {
    return [...this.history];
  }
}
