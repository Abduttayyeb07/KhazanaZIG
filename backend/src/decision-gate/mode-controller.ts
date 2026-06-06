import { ModeManager } from "../modes/manager.js";
import type { StateEngine } from "../state-engine/index.js";
import type { Logger } from "@zig/logger";
import type { OperationalMode, ModeTransition } from "@zig/shared-types";

export class ModeController {
  private readonly manager: ModeManager;
  private readonly stateEngine: StateEngine;

  constructor(initial: OperationalMode, stateEngine: StateEngine, log: Logger) {
    this.manager = new ModeManager(initial, log);
    this.stateEngine = stateEngine;

    this.manager.on("modeChange", (transition: ModeTransition) => {
      this.stateEngine.dispatch({ type: "MODE_CHANGED", mode: transition.to, source: "mode-controller" });
    });

    // Propagate the configured startup mode into the StateEngine. Without this the
    // engine stays at its READ_ONLY default and the decision gate would block
    // execution even when configured for PAPER_MODE/NORMAL.
    this.stateEngine.dispatch({ type: "MODE_CHANGED", mode: initial, source: "mode-controller" });
  }

  get mode(): OperationalMode {
    return this.manager.mode;
  }

  transition(to: OperationalMode, reason: string, triggeredBy: ModeTransition["triggeredBy"] = "system"): void {
    this.manager.transition(to, reason, triggeredBy);
  }

  halt(reason: string, triggeredBy: ModeTransition["triggeredBy"] = "system"): void {
    this.manager.halt(reason, triggeredBy);
  }

  canExecute(): boolean {
    return this.manager.canExecute();
  }

  canPaperTrade(): boolean {
    return this.manager.canPaperTrade();
  }
}
