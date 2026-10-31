/**
 * A run's status and the actions it allows: one rule for the engine, which
 * refuses by it, and for every screen, which offers only what it allows.
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
export { finishedShare } from "./share";
export type { RunResult, RunStatus } from "./status";
