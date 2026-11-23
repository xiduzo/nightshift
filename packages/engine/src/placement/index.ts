/** Placement: where a run's steps run. The plan made once at the start (`planNodes` over the port's Devices), as rules in `domain/` that ask the fit check and the Devices through functions. The walk's reader of the plan and the fit check are in `graph`. */

export type {
	PlacedDevice,
	PlanDevices,
	PlanInput,
	PlannedRun,
} from "./application/plan-nodes";
export type { PlacementPort } from "./application/ports";
export { UNREACHABLE_DEVICE } from "./domain/device-order";
export type { OfferedPlacement } from "./domain/plan-shapes";
export { wirePlacement } from "./wire";
