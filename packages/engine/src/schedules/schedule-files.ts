import type { Schedule } from "@nightshift/flows";
import { readSchedulesFile, writeSchedulesFile } from "@nightshift/flows/files";
import type { Actor, OffersPort } from "../contract";
import type { RunStatus } from "../log";
import type {
	ScheduleList,
	ScheduleRecord,
	ScheduleResult,
	Scheduler,
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
	scheduler: Pick<Scheduler, "refresh" | "nextAt" | "last">;
	/** The latest webhooks of each webhook schedule. */
	webhooks: Pick<Webhooks, "deliveries">;
	/** The run's status, or null when the log knows no such run. */
	runStatus(runId: string): Promise<RunStatus | null>;
	/** The schedules as a Person saves them, with the Offers of another Person's Device (`Peers.offers`). */
	schedulesWithOffers: OffersPort["schedulesWithOffers"];
};

export type ScheduleFiles = ReturnType<typeof createScheduleFiles>;

export function createScheduleFiles(deps: ScheduleFilesDeps) {
	const { scheduler } = deps;

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
		async list(project: {
			id: string;
			repoPath: string;
		}): Promise<ScheduleList> {
			const loaded = await readSchedulesFile(project.repoPath);
			await scheduler.refresh();
			const at = deps.now();
			const schedules = [];
			for (const schedule of loaded.schedules) {
				schedules.push({
					...schedule,
					nextAt: scheduler.nextAt(project.id, schedule, at),
					last: await scheduleResult(scheduler.last(project.id, schedule.id)),
					deliveries: schedule.webhook
						? await deps.webhooks.deliveries(project.id, schedule.id)
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

		/** Writes the project's schedules file, with the Person of each schedule on another Person's Device. */
		async save(
			project: { id: string; repoPath: string },
			spaceId: string,
			actor: Actor | undefined,
			schedules: readonly Schedule[],
		) {
			return writeSchedulesFile(
				project.repoPath,
				await deps.schedulesWithOffers(project, spaceId, actor, schedules),
			);
		},
	};
}
