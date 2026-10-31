import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Actor, OffersPort } from "../contract";
import type { ProjectFlows } from "../flows";
import type { RunStatus } from "../log";
import type { RunSummary } from "../read";
import {
	pausedAt,
	pauseTonightEnds,
	type ScheduleList,
	type SchedulePause,
	type ScheduleRecord,
	type ScheduleResult,
	type Scheduler,
} from "./scheduler";
import type { Webhooks } from "./webhooks";

/**
 * A project's schedules file as a person reads and saves it: each
 * schedule with its next start and how its last cron time went (a
 * webhook's: its latest deliveries), and on a save the Person each
 * schedule on another Person's Device runs for.
 */
export type ScheduleFilesDeps = {
	now(): number;
	/** The project's schedules and flows. */
	flows: Pick<ProjectFlows, "flows" | "schedules" | "saveSchedules">;
	scheduler: Pick<Scheduler, "refresh" | "nextAt" | "last" | "runNow">;
	/** The latest webhooks of each webhook schedule. */
	webhooks: Pick<Webhooks, "deliveries">;
	/** The run's status, or null when the log knows no such run. */
	runStatus(runId: string): Promise<RunStatus | null>;
	/** The schedules as a Person saves them, with the Offers of another Person's Device (`Peers.offers`). */
	schedulesWithOffers: OffersPort["schedulesWithOffers"];
};

export type ScheduleFiles = ReturnType<typeof createScheduleFiles>;

/**
 * Each schedule that starts at a time (`cron`) or stops at one (`stopAt`)
 * and has no time zone, on the clock of `timeZone`. One on another clock
 * keeps it.
 */
export function withTimeZone(
	schedules: readonly Schedule[],
	timeZone: string,
): Schedule[] {
	return schedules.map((schedule) =>
		schedule.timeZone === undefined &&
		(schedule.cron !== undefined || schedule.stopAt !== undefined)
			? { ...schedule, timeZone }
			: schedule,
	);
}

/** The schedule without a pause that has ended: a past `pausedUntil` means nothing. */
function withoutEndedPause(schedule: Schedule, at: number): Schedule {
	if (schedule.pausedUntil === undefined || pausedAt(schedule, at)) {
		return schedule;
	}
	const { pausedUntil: _ended, ...rest } = schedule;
	return rest;
}

const SCHEDULE_NOT_FOUND =
	"This schedule does not exist. Someone may have removed it.";

export function createScheduleFiles(deps: ScheduleFilesDeps) {
	const { scheduler } = deps;

	/** The project's schedules as the file has them, and the one of `scheduleId`. */
	async function find(projectId: string, scheduleId: string) {
		const { schedules } = await deps.flows.schedules(projectId, {
			validate: false,
		});
		const schedule = schedules.find((one) => one.id === scheduleId);
		if (!schedule) throw new Refusal("not-found", SCHEDULE_NOT_FOUND);
		return { schedules, schedule };
	}

	/** Writes the schedule's pause (or none), and what it does to its next start. */
	async function setPause(
		projectId: string,
		schedules: readonly Schedule[],
		changed: Schedule,
	): Promise<SchedulePause> {
		await deps.flows.saveSchedules(
			projectId,
			schedules.map((one) => (one.id === changed.id ? changed : one)),
		);
		const at = deps.now();
		await scheduler.refresh();
		return {
			pausedUntil: changed.pausedUntil ?? null,
			nextAt: scheduler.nextAt(projectId, changed, at),
		};
	}

	/** A logged schedule fact, with the status of the run it started. */
	async function scheduleResult(
		record: ScheduleRecord | null,
	): Promise<ScheduleResult | null> {
		if (!record) return null;
		if (record.kind !== "fired") return record;
		return { ...record, runStatus: await deps.runStatus(record.runId) };
	}

	return {
		/** The project's schedules, each with its next start, its last result and its issues. */
		async list(projectId: string): Promise<ScheduleList> {
			const loaded = await deps.flows.schedules(projectId);
			await scheduler.refresh();
			const at = deps.now();
			const schedules = [];
			for (const stored of loaded.schedules) {
				const schedule = withoutEndedPause(stored, at);
				schedules.push({
					...schedule,
					nextAt: scheduler.nextAt(projectId, schedule, at),
					last: await scheduleResult(scheduler.last(projectId, schedule.id)),
					deliveries: schedule.webhook
						? await deps.webhooks.deliveries(projectId, schedule.id)
						: [],
					issues: loaded.issues.filter(
						(issue) => issue.scheduleId === schedule.id,
					),
				});
			}
			return {
				path: loaded.path,
				schedules,
				issues: loaded.issues.filter((issue) => issue.scheduleId === undefined),
			};
		},

		/**
		 * Pauses the schedule tonight (`pauseTonightEnds`): its next start
		 * and every start until the morning after it start no run. Refuses
		 * (`invalid`) a schedule that is off, has a webhook, or has no next
		 * start.
		 */
		async pauseTonight(
			projectId: string,
			scheduleId: string,
		): Promise<SchedulePause> {
			const { schedules, schedule } = await find(projectId, scheduleId);
			const at = deps.now();
			await scheduler.refresh();
			const next = scheduler.nextAt(projectId, withoutPause(schedule), at);
			if (next === null) {
				throw new Refusal(
					"invalid",
					!schedule.enabled
						? "This schedule is off. It starts nothing tonight."
						: schedule.webhook
							? "This schedule starts on a webhook. It has no times to pause."
							: "This schedule has no next start to pause.",
				);
			}
			const until = pauseTonightEnds(next, schedule.timeZone);
			if (until === null) {
				throw new Refusal(
					"invalid",
					"This schedule has no next start to pause.",
				);
			}
			return setPause(projectId, schedules, {
				...schedule,
				pausedUntil: until,
			});
		},

		/** Ends the schedule's pause tonight: it starts at its next time again. A schedule without a pause stays as it is. */
		async resumeTonight(
			projectId: string,
			scheduleId: string,
		): Promise<SchedulePause> {
			const { schedules, schedule } = await find(projectId, scheduleId);
			return setPause(projectId, schedules, withoutPause(schedule));
		},

		/**
		 * Starts the schedule's run now, as if it fired now (`Scheduler.runNow`),
		 * for `personId` when the schedule names no Person. A pause stays.
		 */
		async runNow(
			projectId: string,
			scheduleId: string,
			personId: string | null,
		): Promise<RunSummary> {
			const { schedule } = await find(projectId, scheduleId);
			return scheduler.runNow(projectId, schedule, personId);
		},

		/**
		 * Saves the project's schedules, with the Person of each schedule on
		 * another Person's Device. `timeZone` is the saver's clock: each
		 * schedule with a time and no time zone of its own gets it.
		 */
		async save(
			spaceId: string,
			projectId: string,
			actor: Actor | undefined,
			schedules: readonly Schedule[],
			timeZone?: string,
		) {
			const project = {
				id: projectId,
				flows: () => deps.flows.flows(projectId),
			};
			return deps.flows.saveSchedules(
				projectId,
				await deps.schedulesWithOffers(
					project,
					spaceId,
					actor,
					timeZone ? withTimeZone(schedules, timeZone) : schedules,
				),
			);
		},
	};
}

function withoutPause(schedule: Schedule): Schedule {
	const { pausedUntil: _pause, ...rest } = schedule;
	return rest;
}
