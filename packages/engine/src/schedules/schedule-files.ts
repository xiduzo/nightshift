import type { Schedule } from "@nightshift/flows";
import type { Actor, OffersPort } from "../contract";
import type { ProjectFlows } from "../flows";
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
	/** The project's schedules and flows. */
	flows: Pick<ProjectFlows, "flows" | "schedules" | "saveSchedules">;
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
		async list(spaceId: string, projectId: string): Promise<ScheduleList> {
			const loaded = await deps.flows.schedules({ projectId, spaceId });
			await scheduler.refresh();
			const at = deps.now();
			const schedules = [];
			for (const schedule of loaded.schedules) {
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

		/** Saves the project's schedules, with the Person of each schedule on another Person's Device. */
		async save(
			spaceId: string,
			projectId: string,
			actor: Actor | undefined,
			schedules: readonly Schedule[],
		) {
			const of = { projectId, spaceId };
			const project = {
				id: projectId,
				flows: async () => (await deps.flows.flows(of)).sources,
			};
			return deps.flows.saveSchedules(
				of,
				await deps.schedulesWithOffers(project, spaceId, actor, schedules),
			);
		},
	};
}
