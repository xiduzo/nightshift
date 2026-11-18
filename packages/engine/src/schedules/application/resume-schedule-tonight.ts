import type { Actor } from "../../contract";
import { type SchedulePause, withoutPause } from "../domain/pause-tonight";
import { scheduleOf, withSchedule } from "../domain/saved-schedules";
import type { ScheduleWatch } from "../domain/schedule-watch";
import type {
	Clock,
	ScheduledProjects,
	ScheduleLog,
	ScheduleStore,
} from "./ports";

export type ResumeScheduleTonightPorts = {
	projects: Pick<ScheduledProjects, "inSpace">;
	store: Pick<ScheduleStore, "list" | "save">;
	log: Pick<ScheduleLog, "histories">;
	clock: Clock;
	/** The watch of this engine: what its scheduler does next. */
	watch: Pick<ScheduleWatch, "nextStart">;
};

export type ResumeScheduleTonight = {
	spaceId: string;
	projectId: string;
	scheduleId: string;
};

/**
 * Ends one schedule's pause tonight: it starts at its next time again. A
 * schedule without a pause is saved as it is. Refuses (`not-found`) a
 * project that is not in the Space and a schedule that does not exist.
 */
export const resumeScheduleTonight =
	(ports: ResumeScheduleTonightPorts) =>
	async (
		_actor: Actor | undefined,
		request: ResumeScheduleTonight,
	): Promise<SchedulePause> => {
		const { projects, store, log, clock, watch } = ports;
		const { spaceId, projectId, scheduleId } = request;

		await projects.inSpace(projectId, spaceId);
		const { schedules } = await store.list(projectId, { validate: false });
		const resumed = withoutPause(scheduleOf(schedules, scheduleId));
		await store.save(projectId, withSchedule(schedules, resumed));

		// The save took time: the clock is read after it, then the log.
		const saved = clock();
		const histories = await log.histories();
		return {
			pausedUntil: resumed.pausedUntil ?? null,
			nextAt: watch.nextStart(
				projectId,
				resumed,
				saved,
				histories.of(projectId, resumed.id),
			),
		};
	};
