/** Start: a run's start, by a person, by Night Shift in this process, or by a schedule. Who walks the run (this computer, or the Host that keeps the Space), its plan and its checks, and the row and `RunStarted` in one batch. Also the Devices a person chooses from. `wireStart` binds the use cases to their ports. */

export { START_DEADLINE_MS } from "./domain/start-deadline";
export { PinNotHereError } from "./domain/test-run";
export { type Start, wireStart } from "./wire";
