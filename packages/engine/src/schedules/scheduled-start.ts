import {
	type JsonValue,
	nextTimeOfDay,
	type Schedule,
} from "@nightshift/flows";
import type { StartRunInput } from "../contract";

/**
 * The run a schedule starts at `at`, as the scheduler's tick, Run now and
 * a webhook all start it: the flow `flowName` with the schedule's inputs,
 * its base ref, the first stop time after `at` on the schedule's clock,
 * and the schedule's Person as its starter. The trigger, and what a start
 * that fails does, stay with the caller.
 */
export function scheduledStart(
	projectId: string,
	schedule: Schedule,
	flowName: string,
	at: number,
	options: {
		/** The inputs instead of the schedule's own: a webhook's, filled from its event. */
		inputs?: Record<string, JsonValue>;
		/** The starter when the schedule names no Person: the person who clicked Run now. */
		startedBy?: string;
	} = {},
): StartRunInput {
	const stopAt = schedule.stopAt
		? (nextTimeOfDay(schedule.stopAt, at, schedule.timeZone) ?? undefined)
		: undefined;
	const startedBy = schedule.person ?? options.startedBy;
	return {
		projectId,
		flowName,
		inputs: options.inputs ?? schedule.inputs,
		...(schedule.baseRef ? { baseRef: schedule.baseRef } : {}),
		...(stopAt !== undefined ? { stopAt } : {}),
		// Another Person's schedule: their run, through the Offers here.
		...(startedBy ? { startedBy } : {}),
	};
}
