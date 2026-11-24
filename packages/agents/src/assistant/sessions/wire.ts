import { settleCost } from "../../pricing";
import { activityOf } from "./adapters/out/activity-lines";
import { runReport } from "./application/run-report";
import { runSession } from "./application/run-session";

export type Sessions = ReturnType<typeof wireSessions>;

/** The wiring of sessions: the price list and the activity lines. */
export function wireSessions() {
	const run = runSession({
		activityOf,
		costOf: (usage, model) => settleCost(usage, model).costUsd,
	});
	return { runSession: run, runReport: runReport({ runSession: run }) };
}
