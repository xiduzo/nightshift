import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../contract";
import { type SchedulePause, withoutPause } from "../domain/pause-tonight";
import { scheduleOf, withSchedule } from "../domain/saved-schedules";
import type { ScheduleWatch } from "../domain/schedule-watch";
import type {
	Clock,
	ScheduleAccess,
	ScheduledProjects,
	ScheduleLog,
	ScheduleNotices,
	ScheduleStore,
} from "./ports";

/** What a role must allow to pause a schedule or end its pause: what stops runs. */
const STOPS_RUNS: Permissions = { run: ["stop"] };

export type ResumeScheduleTonightPorts = {
	access: ScheduleAccess;
	projects: Pick<ScheduledProjects, "inSpace">;
	store: Pick<ScheduleStore, "list" | "save">;
	log: Pick<ScheduleLog, "histories">;
	clock: Clock;
	/** The watch of this engine: what its scheduler does next. */
	watch: Pick<ScheduleWatch, "nextStart">;
	notices: Pick<ScheduleNotices, "changed">;
};

export type ResumeScheduleTonight = {
	spaceId: string;
	projectId: string;
	scheduleId: string;
};

/**
 * Ends one schedule's pause tonight: it starts at its next time again. A
 * schedule without a pause is saved as it is. The open screens of the
 * Space hear of it last, and the request waits for that.
 *
 * Refuses a Person who may not stop runs in the Space, before anything
 * else (`access.openSpace`: not a Member, or a role that does not allow
 * it). Refuses (`not-found`) a project that is not in the Space and a
 * schedule that does not exist.
 */
export const resumeScheduleTonight =
	(ports: ResumeScheduleTonightPorts) =>
	async (
		actor: Actor,
		request: ResumeScheduleTonight,
	): Promise<SchedulePause> => {
		const { access, projects, store, log, clock, watch, notices } = ports;
		const { spaceId, projectId, scheduleId } = request;

		await access.openSpace(actor, { spaceId, need: STOPS_RUNS });
		await projects.inSpace(projectId, spaceId);
		const { schedules } = await store.list(projectId, { validate: false });
		const resumed = withoutPause(scheduleOf(schedules, scheduleId));
		await store.save(projectId, withSchedule(schedules, resumed));

		// The save took time: the clock is read after it, then the log.
		const saved = clock();
		const histories = await log.histories();
		const pause = {
			pausedUntil: resumed.pausedUntil ?? null,
			nextAt: watch.nextStart(
				projectId,
				resumed,
				saved,
				histories.of(projectId, resumed.id),
			),
		};
		await notices.changed(spaceId, projectId);
		return pause;
	};
