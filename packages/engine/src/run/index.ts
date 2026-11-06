/** The run lifecycle: the engine of this Device (`Engine`, `EngineOptions`) and the view of one Space (`SpaceEngine`), the port of the other Devices it walks with (`Peers`), starting a run, what a person does to a run, and recovery after a restart. */

export { GateClosedError } from "./actions";
export { createEngine, type Engine } from "./engine";
export type { EngineOptions } from "./engine-options";
export type {
	PeerContext,
	PeerProfiles,
	PeerProjects,
	Peers,
} from "./peers";
export type { MoveRows } from "./projects-move";
export { START_DEADLINE_MS } from "./run-start";
export type { SpaceEngine } from "./space-engine";
