/** Runs: what every use case that writes to a run shares (`walk`), what a person does to a run (`actions`), a run's start (`start`), the plan of where steps run (`placement`), the removal of what ended runs left (`cleanup`), the move of a run's walk to another Device (`move`), what Night Shift does to a run on its own (`recovery`), and what people see of the runs (`views`). Each sub-vertical has its own rings and its `wire.ts`. From outside `runs/`, this barrel is the only door. */

export { type Actions, wireActions } from "./actions";
export type { Cleanup, RunFiles } from "./cleanup";
export { wireCleanup } from "./cleanup";
export { type Move, wireMove } from "./move";
export {
	type OfferedPlacement,
	type PlacedDevice,
	type PlacementPort,
	type PlanDevices,
	type PlanInput,
	type PlannedRun,
	UNREACHABLE_DEVICE,
	wirePlacement,
} from "./placement";
export { wireRecovery } from "./recovery";
export {
	PinNotHereError,
	START_DEADLINE_MS,
	type Start,
	wireStart,
} from "./start";
export { type RunHere, type Views, wireViews } from "./views";
export { type StartHolds, type Walk, wireWalk } from "./walk";
