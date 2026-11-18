import type { ScheduleLog } from "../../application/ports";
import {
	createScheduleHistories,
	type ScheduleFact,
} from "../../domain/schedule-history";
import {
	deliveryOf,
	type WebhookReceivedFact,
} from "../../domain/webhook-delivery";

/**
 * The schedule facts of a log, in memory: what `inMemoryScheduleLog`
 * reads and appends. Two logs over the same facts see the same histories,
 * as two daemons over the same database do (a restart).
 */
export type InMemoryScheduleFacts = {
	/** The fired and skipped facts and the starts of scheduled runs, in the order they were logged. */
	schedule: ScheduleFact[];
	/** The webhooks whose secret checked out, in the order they arrived. */
	webhooks: WebhookReceivedFact[];
};

/** The in-memory adapter of `ScheduleLog`, with the facts a test reads and seeds. */
export type InMemoryScheduleLog = ScheduleLog & {
	facts: InMemoryScheduleFacts;
	/**
	 * A run started with the schedule as its trigger, as the run's own
	 * start logs it. `fired` does not call this.
	 */
	runStarted(fact: {
		projectId: string;
		scheduleId: string;
		at: number;
		runId: string;
	}): void;
};

export function inMemoryScheduleLog(
	facts: InMemoryScheduleFacts = { schedule: [], webhooks: [] },
): InMemoryScheduleLog {
	const histories = createScheduleHistories();
	// How many facts this log has read: the cursor of the real adapter.
	let read = 0;

	return {
		facts,

		runStarted(fact) {
			facts.schedule.push({ kind: "run-started", ...fact });
		},

		async histories() {
			for (const fact of facts.schedule.slice(read)) histories.apply(fact);
			read = facts.schedule.length;
			return histories;
		},

		async fired(fact) {
			facts.schedule.push({ kind: "fired", ...fact });
			histories.apply({ kind: "fired", ...fact });
		},

		async skipped(fact) {
			facts.schedule.push({ kind: "skipped", ...fact });
			histories.apply({ kind: "skipped", ...fact });
		},

		async received(fact) {
			facts.webhooks.push(fact);
		},

		async deliveries(projectId, scheduleId, limit) {
			return facts.webhooks
				.filter(
					(fact) =>
						fact.projectId === projectId && fact.scheduleId === scheduleId,
				)
				.reverse()
				.slice(0, limit)
				.map(deliveryOf);
		},
	};
}
