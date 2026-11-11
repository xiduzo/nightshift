/** Placement: where a run's steps run. The plan made once at the start (`planNodes` over the port's Devices), the one fit check (`REQUIREMENTS`, `unfit`), and the walk's reader of the plan (`createPlacement`): the Device of a step now, and its move when that Device is offline. */

export {
	capabilitiesFor,
	olderNightShift,
	refusalOf,
	UNADVERTISED_FLOW_VERSION,
} from "./fit";
export { createPlacement } from "./placement";
export type {
	OfferedPlacement,
	PlacedDevice,
	PlacementPort,
	PlanInput,
	PlannedRun,
} from "./port";
export { type PlanDevices, planNodes, UNREACHABLE_DEVICE } from "./run-plan";
