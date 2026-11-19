import { Refusal } from "@nightshift/refusal";
import { type Actor, personOf } from "../../contract";
import type { RunSummary } from "../../read";
import { openRunOf, openRunRefusalWords } from "../domain/open-run";
import { scheduleOf } from "../domain/saved-schedules";
import { scheduledStart } from "../domain/scheduled-start";
import type {
	Clock,
	ScheduledProjects,
	ScheduledRuns,
	ScheduleLog,
	ScheduleStore,
} from "./ports";

export type RunScheduleNowPorts = {
	projects: Pick<ScheduledProjects, "inSpace">;
	runs: Pick<ScheduledRuns, "shownTo" | "status" | "start">;
	store: Pick<ScheduleStore, "list">;
	log: Pick<ScheduleLog, "histories" | "fired">;
	clock: Clock;
};

export type RunScheduleNow = {
	spaceId: string;
	projectId: string;
	scheduleId: string;
};

/**
 * Starts one schedule's run now, as if it fired now: its flow, inputs,
 * base ref, stop time and Device, with the schedule as its trigger (`at`
 * is now). The run is the schedule's Person's, else the actor's. A pause
 * tonight stays. It works with the scheduler switched off.
 *
 * Refuses (`not-found`) a project that is not in the Space and a schedule
 * that does not exist, (`invalid`) a schedule that starts no flow, and
 * (`conflict`) while an earlier run of the schedule is still open, as a
 * cron time skips. What the start refuses passes through.
 */
export const runScheduleNow =
	(ports: RunScheduleNowPorts) =>
	async (
		actor: Actor | undefined,
		request: RunScheduleNow,
	): Promise<RunSummary> => {
		const { projects, runs, store, log, clock } = ports;
		const { spaceId, projectId, scheduleId } = request;

		await projects.inSpace(projectId, spaceId);
		// Asked before the start: who may see the paths of the run.
		const shown = await runs.shownTo(spaceId, actor);
		const { schedules } = await store.list(projectId, { validate: false });
		const schedule = scheduleOf(schedules, scheduleId);
		const { flow } = schedule;
		if (flow === undefined) {
			throw new Refusal("invalid", "This schedule starts no flow.");
		}
		const histories = await log.histories();
		const open = await openRunOf(
			histories.of(projectId, schedule.id),
			runs.status,
		);
		if (open) throw new Refusal("conflict", openRunRefusalWords(open));

		const at = clock();
		const run = await runs.start(
			scheduledStart(projectId, schedule, flow, at, {
				startedBy: (actor && personOf(actor)) ?? undefined,
			}),
			{ kind: "schedule", scheduleId: schedule.id, at },
		);
		// A cron time before now counts as handled: it does not fire as well.
		await log.fired({
			projectId,
			scheduleId: schedule.id,
			at,
			runId: run.id,
			error: null,
		});
		return shown(run);
	};
