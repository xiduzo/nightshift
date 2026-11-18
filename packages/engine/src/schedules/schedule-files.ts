import type { ProjectFlows } from "../flows";
import type { UsageNotes } from "../usage";
import { flowDocumentScheduleStore } from "./adapters/out/flow-document-schedule-store";
import { listSchedules } from "./application/list-schedules";
import { pauseScheduleTonight } from "./application/pause-schedule-tonight";
import type { ScheduledRuns, ScheduleOffers } from "./application/ports";
import { resumeScheduleTonight } from "./application/resume-schedule-tonight";
import { runScheduleNow } from "./application/run-schedule-now";
import { saveSchedules } from "./application/save-schedules";
import type { Scheduler } from "./scheduler";
import type { Webhooks } from "./webhooks";

/**
 * A project's schedules as a person reads, saves, pauses and starts
 * them, as the engine still makes them: a facade that binds the five use
 * cases of `application/` to their ports. It goes when `wire.ts` binds
 * them.
 */
export type ScheduleFilesDeps = {
	now(): number;
	/** The project's schedules and flows. */
	flows: Pick<ProjectFlows, "flows" | "schedules" | "saveSchedules">;
	/** The scheduler's log, watch and runs: one of each for the engine. */
	scheduler: Pick<Scheduler, "log" | "watch" | "runs">;
	/** The refused webhooks this engine remembers. */
	webhooks: Pick<Webhooks, "refusals">;
	/** Hides the worktree paths of runs on Devices the actor does not own. */
	pathsFor: ScheduledRuns["shownTo"];
	/** The project's row when it is in the Space, else "not found". */
	project(
		projectId: string,
		spaceId: string,
	): Promise<{ folder: boolean; repoPath: string | null }>;
	/** The Offer rule of a schedule on another Person's Device (`Peers.offers`). */
	offers: ScheduleOffers;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
};

export type ScheduleFiles = ReturnType<typeof createScheduleFiles>;

export function createScheduleFiles(deps: ScheduleFilesDeps) {
	const { log, watch } = deps.scheduler;
	const ports = {
		clock: () => deps.now(),
		store: flowDocumentScheduleStore(deps.flows),
		log,
		watch,
		refusals: deps.webhooks.refusals,
		runs: { ...deps.scheduler.runs, shownTo: deps.pathsFor },
		projects: {
			inSpace: async (projectId: string, spaceId: string) => {
				const row = await deps.project(projectId, spaceId);
				return {
					hasFolder: Boolean(row.folder),
					clonedHere: row.repoPath !== null,
				};
			},
		},
		offers: deps.offers,
		...(deps.usage ? { usage: deps.usage } : {}),
	};
	return {
		list: listSchedules(ports),
		save: saveSchedules(ports),
		pauseTonight: pauseScheduleTonight(ports),
		resumeTonight: resumeScheduleTonight(ports),
		runNow: runScheduleNow(ports),
	};
}
