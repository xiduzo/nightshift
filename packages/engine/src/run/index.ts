/** The run lifecycle: the engine of this Device (`Engine`, `EngineOptions`) and the view of one Space (`SpaceEngine`), the port of the other Devices it walks with (`Peers`), starting a run and the node walk of its plan, what a person does to a run, and recovery after a restart. */

export { GateClosedError } from "./actions";
export { createEngine, type Engine } from "./engine";
export type { EngineOptions } from "./engine-options";
export type {
	OfferedPlacement,
	PeerContext,
	Peers,
	PlacedDevice,
	PlanInput,
	PlannedRun,
} from "./peers";
export { HOST_UNREACHABLE, HostUnreachableError } from "./relay";
export { type PlanDevices, planNodes, UNREACHABLE_DEVICE } from "./run-plan";
export type { SpaceEngine } from "./space-engine";
export { START_HOLD_WORDS } from "./start-holds";
