/** The run state: one fold of a run's log. With it, its cost arithmetic, what the run holds, and the stamps of the copies of a step's files. No file here imports a database, a folder or a process. */

export { type CopyStamp, copyStamps, stampHolds } from "./copy-stamp";
export { addCost, type CostTally, NO_COST, sessionCost } from "./cost";
export { foldRun, nextState } from "./fold-run";
export {
	type Hold,
	holdCovers,
	type LeaseHold,
	leavingHolds,
	type ServiceHold,
} from "./holds";
export {
	type DerivedItem,
	type DerivedSession,
	type DerivedStep,
	type EarlyWake,
	type OpenGateFact,
	type RunState,
	type SleepFact,
	type StepSleep,
	type StopFact,
	type VariableChange,
	visitKey,
} from "./run-state";
