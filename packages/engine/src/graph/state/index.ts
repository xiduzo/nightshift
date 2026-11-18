/** The state of the compiled graph: what a walk keeps between its nodes and in its Checkpoints. */

export {
	type CascadePosition,
	type CascadeTry,
	type Ended,
	heldOf,
	type JoinRound,
	type Loop,
	type Parked,
	type Pending,
	type PendingGate,
	type PendingParked,
	type PendingWait,
	type PositionState,
	type ResumeValue,
	type RunEvent,
	RunState,
	type RunStateUpdate,
	type RunStateValues,
} from "./state";
