/**
 * What the event log knows of each schedule: how its latest handled cron
 * time went, and the runs it started. A cron time fires at most once, so
 * every rule of the scheduler starts from this.
 */

/** How the latest handled cron time of a schedule went, as logged. */
export type ScheduleRecord =
	| { kind: "fired"; at: number; runId: string }
	| { kind: "failed"; at: number; error: string }
	| { kind: "skipped"; at: number; reason: string; runId: string | null };

/** What the log keeps of one schedule. */
export type ScheduleHistory = {
	/** The latest cron time that fired or was skipped. */
	lastAt: number;
	last: ScheduleRecord;
	/** The runs this schedule started, oldest first. */
	runIds: string[];
};

/** A cron time started a run, or its start failed (`runId` null, with the `error`). */
export type ScheduleFiredFact = {
	projectId: string;
	scheduleId: string;
	/** The cron time (epoch ms). For Run now: the moment it was asked. */
	at: number;
	runId: string | null;
	error: string | null;
};

/** A cron time did not start, and why. */
export type ScheduleSkippedFact = {
	projectId: string;
	scheduleId: string;
	at: number;
	reason: string;
	/** The earlier run that still runs, when that is the reason. */
	runId: string | null;
};

/**
 * A fact of the log that tells of a schedule. `run-started` is the start
 * of a run with the schedule as its trigger: it closes the gap when the
 * daemon dies between the start and its `fired`.
 */
export type ScheduleFact =
	| {
			kind: "run-started";
			projectId: string;
			scheduleId: string;
			at: number;
			runId: string;
	  }
	| ({ kind: "fired" } & ScheduleFiredFact)
	| ({ kind: "skipped" } & ScheduleSkippedFact);

/** The histories of every schedule, as read. */
export type ScheduleHistories = {
	of(projectId: string, scheduleId: string): ScheduleHistory | undefined;
};

/** The histories, and the one way they change: a fact of the log. */
export type ScheduleHistoryBook = ScheduleHistories & {
	apply(fact: ScheduleFact): void;
};

/** A schedule's key: a schedule id is unique in its project only. */
export function scheduleKey(projectId: string, scheduleId: string): string {
	return `${projectId}/${scheduleId}`;
}

/** How a `fired` fact reads: a run, or the words of the start that failed. */
function firedRecord(fact: ScheduleFiredFact): ScheduleRecord {
	return fact.runId
		? { kind: "fired", at: fact.at, runId: fact.runId }
		: {
				kind: "failed",
				at: fact.at,
				error: fact.error ?? "The run did not start.",
			};
}

/** An empty book of histories. Apply the facts of the log in their order. */
export function createScheduleHistories(): ScheduleHistoryBook {
	const history = new Map<string, ScheduleHistory>();

	function record(
		projectId: string,
		scheduleId: string,
		fact: ScheduleRecord,
	): void {
		const key = scheduleKey(projectId, scheduleId);
		const current = history.get(key);
		const runId = fact.kind === "fired" ? fact.runId : null;
		if (!current) {
			history.set(key, {
				lastAt: fact.at,
				last: fact,
				runIds: runId ? [runId] : [],
			});
			return;
		}
		if (runId && !current.runIds.includes(runId)) current.runIds.push(runId);
		if (fact.at >= current.lastAt) {
			current.lastAt = fact.at;
			current.last = fact;
		}
	}

	return {
		of: (projectId, scheduleId) =>
			history.get(scheduleKey(projectId, scheduleId)),
		apply(fact) {
			if (fact.kind === "run-started") {
				record(fact.projectId, fact.scheduleId, {
					kind: "fired",
					at: fact.at,
					runId: fact.runId,
				});
			} else if (fact.kind === "fired") {
				record(fact.projectId, fact.scheduleId, firedRecord(fact));
			} else {
				record(fact.projectId, fact.scheduleId, {
					kind: "skipped",
					at: fact.at,
					reason: fact.reason,
					runId: fact.runId,
				});
			}
		},
	};
}
