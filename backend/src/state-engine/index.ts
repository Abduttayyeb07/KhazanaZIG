import { EventEmitter } from "events";
import type { Logger } from "@zig/logger";
import { initialState } from "./store.js";
import { reduce } from "./reducer.js";
import type { SystemState, StateAction } from "./store.js";

export type { SystemState, StateAction };

export class StateEngine extends EventEmitter {
  private state: SystemState;
  private readonly log: Logger;

  constructor(log: Logger) {
    super();
    this.state = initialState();
    this.log = log.child({ module: "state-engine" });
  }

  dispatch(action: StateAction): void {
    const next = reduce(this.state, action);
    if (next === this.state) return;

    this.state = next;
    this.log.debug({ actionType: action.type }, "State updated");
    this.emit("stateChanged", action.type, this.state);
    this.emit(action.type, this.state);
  }

  getState(): Readonly<SystemState> {
    return this.state;
  }
}
