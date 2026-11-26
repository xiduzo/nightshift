import type { Schedule } from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import type { UsageMoment, UsageNotes } from "../../usage";
import { openRunOf, openRunSkipWords } from "../domain/open-run";
import type { ScheduleHistory } from "../domain/schedule-history";
import {
	type CronSchedule,
	cronScheduleOf,
	type ScheduleWatch,
} from "../domain/schedule-watch";
import { scheduledStart } from "../domain/scheduled-start";
import type {
	Clock,
	ScheduledProjects,
	ScheduledRuns,
	ScheduleLog,
	ScheduleNotices,
	ScheduleStore,
	ScheduleSwitch,
} from "./ports";

/** Why a cron time did not start, as usage notes it. */
type SkipCode = Extract<UsageMoment, { kind: "schedule-skipped" }>["reason"];

export type FireDueSchedulesPorts = {
	log: Pick<ScheduleLog, "histories" | "fired" | "skipped">;
	switch: Pick<ScheduleSwitch, "on">;
	clock: Clock;
	projects: Pick<ScheduledProjects, "all" | "firesHere">;
	store: Pick<ScheduleStore, "list">;
	runs: Pick<ScheduledRuns, "start" | "status">;
	notices: Pick<ScheduleNotices, "missed">;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
	/** The watch of this engine: made once, when the engine is made. */
	watch: ScheduleWatch;
};

/** One look of the scheduler, as its ticker asks for it. */
export type FireDueSchedules = {
	/** Whether a hold is on (a merge of Spaces moves rows): no run starts. */
	held(): boolean;
	/** Whether the scheduler stopped: the look ends where it is. */
	stopped(): boolean;
};

/**
 * One look over every project: starts the run of each schedule whose
 * cron time came due, or logs why it does not start. The clock asks, so
 * there is no actor: which Device fires a schedule is `firesHere`.
 *
 * The order is the rule (`domain/schedule-watch.ts` has it in words):
 * the facts of the log are read first, so a cron time that a run or an
 * earlier look handled never starts again. A hold stops the look before
 * it reads a project, and between two schedules. The Settings switch is
 * read after the hold. One fact is logged per handled time. A start that
 * fails is logged with its words and not tried again. It never throws
 * for a schedule: a project whose schedules do not load is passed over.
 */
export const fireDueSchedules =
	(ports: FireDueSchedulesPorts) =>
	async (request: FireDueSchedules): Promise<void> => {
		const { log, clock, projects, store, runs, notices, usage, watch } = ports;

		async function skip(
			projectId: string,
			scheduleId: string,
			at: number,
			why: SkipCode,
			reason: string,
			runId: string | null = null,
		): Promise<void> {
			await log.skipped({ projectId, scheduleId, at, reason, runId });
			usage?.note({ kind: "schedule-skipped", reason: why });
		}

		async function consider(
			projectId: string,
			schedule: CronSchedule,
			at: number,
			history: ScheduleHistory | undefined,
		): Promise<void> {
			const decision = watch.decide(projectId, schedule, at, history);
			if (decision.kind === "none") return;
			const { due } = decision;
			if (decision.kind === "missed") {
				await skip(projectId, schedule.id, due, decision.kind, decision.reason);
				try {
					notices.missed(decision.missed);
				} catch (error) {
					console.error(
						`[schedules] ${schedule.id}: telling of a miss failed`,
						error,
					);
				}
				return;
			}

			if (decision.kind === "paused") {
				await skip(projectId, schedule.id, due, decision.kind, decision.reason);
				return;
			}

			const open = await openRunOf(history, runs.status);
			if (open) {
				await skip(
					projectId,
					schedule.id,
					due,
					"still_open",
					openRunSkipWords(open),
					open.runId,
				);
				return;
			}

			let runId: string | null = null;
			let error: string | null = null;
			try {
				// It stops on the first stop time after now. Its trigger keeps the cron time.
				const run = await runs.start(
					scheduledStart(projectId, schedule, schedule.flow, at),
					{ kind: "schedule", scheduleId: schedule.id, at: due },
				);
				runId = run.id;
			} catch (cause) {
				// The schedule shows why in words for people. A failure goes to the log.
				if (!(cause instanceof Refusal)) {
					console.error(
						`[schedules] ${schedule.id} did not start a run`,
						cause,
					);
				}
				error = wordsFor(cause);
			}
			await log.fired({
				projectId,
				scheduleId: schedule.id,
				at: due,
				runId,
				error,
			});
			if (runId) usage?.note({ kind: "schedule-fired" });
		}

		const histories = await log.histories();
		if (request.held()) return;
		if (!ports.switch.on()) {
			// Off counts as paused: turning it on again starts from now.
			watch.switchedOff();
			return;
		}
		const at = clock();
		watch.switchedOn(at);
		for (const { id: projectId } of await projects.all()) {
			if (request.stopped() || request.held()) return;
			let schedules: Schedule[];
			try {
				({ schedules } = await store.list(projectId, { validate: false }));
			} catch {
				continue;
			}
			const seen = new Set<string>();
			for (const schedule of schedules) {
				if (request.stopped() || request.held()) return;
				// A duplicate id is an issue in the UI. The first one counts.
				if (seen.has(schedule.id)) continue;
				seen.add(schedule.id);
				// A webhook's schedule starts when the webhook arrives (`receive-webhook.ts`).
				const cron = cronScheduleOf(schedule);
				if (cron === null || !(await projects.firesHere(projectId))) {
					watch.unwatch(projectId, schedule.id);
					continue;
				}
				watch.watch(projectId, schedule.id, at);
				await consider(
					projectId,
					cron,
					at,
					histories.of(projectId, schedule.id),
				);
			}
		}
	};
