/** The events of a run, the words their payloads use, and why a run ended, as a code. */

export {
	guardEndReason,
	RUN_END_REASONS,
	type RunEndReason,
} from "./end-reason";
export {
	type GateVia,
	type PinnedOutput,
	type ResumeAction,
	type ResumedBy,
	type RunEnding,
	type RunPayloads,
	type RunTrigger,
	type RunWarningKind,
	runDueAt,
	type ScoreName,
	type StoppedBy,
	type TestRun,
} from "./run-payloads";
