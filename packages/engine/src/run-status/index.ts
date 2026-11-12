/**
 * A run's status and the actions it allows: one rule for the engine, which
 * refuses by it, and for every screen, which offers only what it allows.
 * With it, how a person's answer to "Was this run useful?" reads,
 * whether a run is a test run, and the report a run ended with.
 * It imports only the refusal type (`@nightshift/refusal`, which imports
 * nothing), so it runs in a browser, in React Native and in Bun:
 * `@nightshift/client` passes it on to the apps (`@nightshift/engine/run-status`).
 */

export {
	ARRIVING,
	type RefusalRule,
	type RunAction,
	type RunActions,
	RunRefusal,
	refuseUnless,
	runActions,
	STILL_RUNNING,
	WALKED_ELSEWHERE,
	whyNot,
} from "./actions";
export { type RunReport, runReport } from "./report";
export { finishedShare } from "./share";
export { endedEarly, type RunResult, type RunStatus } from "./status";
export { isTestRun } from "./test-run";
export { usefulAnswer } from "./useful";
