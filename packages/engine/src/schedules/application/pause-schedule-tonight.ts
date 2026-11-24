import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../access";
import type { Actor } from "../../contract";
import {
	pausedTonight,
	type SchedulePause,
	withoutPause,
} from "../domain/pause-tonight";
import { scheduleOf, withSchedule } from "../domain/saved-schedules";
import type { ScheduleWatch } from "../domain/schedule-watch";
import type {
	Clock,
	ScheduledProjects,
	ScheduleLog,
	ScheduleNotices,
	ScheduleStore,
} from "./ports";

/** What a role must allow to pause a schedule or end its pause: what stops runs. */
const STOPS_RUNS: Permissions = { run: ["stop"] };

export type PauseScheduleTonightPorts = {
	access: Pick<Access, "openSpace">;
	projects: Pick<ScheduledProjects, "inSpace">;
	store: Pick<ScheduleStore, "list" | "save">;
	log: Pick<ScheduleLog, "histories">;
	clock: Clock;
	/** The watch of this engine: what its scheduler does next. */
	watch: Pick<ScheduleWatch, "nextStart">;
	notices: Pick<ScheduleNotices, "changed">;
};

export type PauseScheduleTonight = {
	spaceId: string;
	projectId: string;
	scheduleId: string;
};

/**
 * Pauses one schedule tonight: its next start and every start until the
 * morning after it start no run (`domain/pause-tonight.ts`). The pause is
 * saved in the schedule, so every Device and the Host see it. The open
 * screens of the Space hear of it last, and the request waits for that.
 *
 * Refuses a Person who may not stop runs in the Space, before anything
 * else (`access.openSpace`: not a Member, or a role that does not allow
 * it). Refuses (`not-found`) a project that is not in the Space and a
 * schedule that does not exist, and (`invalid`) a schedule that is off,
 * has a webhook or has no next start.
 */
export const pauseScheduleTonight =
	(ports: PauseScheduleTonightPorts) =>
	async (
		actor: Actor,
		request: PauseScheduleTonight,
	): Promise<SchedulePause> => {
		const { access, projects, store, log, clock, watch, notices } = ports;
		const { spaceId, projectId, scheduleId } = request;

		await access.openSpace(actor, { spaceId, need: STOPS_RUNS });
		await projects.inSpace(projectId, spaceId);
		const { schedules } = await store.list(projectId, { validate: false });
		const schedule = scheduleOf(schedules, scheduleId);
		const at = clock();
		const histories = await log.histories();
		const next = watch.nextStart(
			projectId,
			withoutPause(schedule),
			at,
			histories.of(projectId, schedule.id),
		);
		const paused = pausedTonight(schedule, next);
		await store.save(projectId, withSchedule(schedules, paused));

		// The save took time: the clock and the log are read again.
		const saved = clock();
		const after = await log.histories();
		const pause = {
			pausedUntil: paused.pausedUntil ?? null,
			nextAt: watch.nextStart(
				projectId,
				paused,
				saved,
				after.of(projectId, paused.id),
			),
		};
		await notices.changed(spaceId, projectId);
		return pause;
	};
