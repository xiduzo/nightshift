/** Where a run is and what it allows now: the status table and its groups, the actions, what the run page says (`runNow`), and the share of runs that finished. */

export type { RunActing, RunActions } from "./actions";
export { flowUnreadWords } from "./flow-unread";
export {
	openGates,
	type RunNotice,
	type RunNow,
	runNow,
	walkerName,
} from "./run-now";
export {
	groupStatuses,
	hasEnded,
	type RunGroup,
	runStatusLabel,
	type StatusKey,
	statusOf,
} from "./status";
