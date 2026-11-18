import type { Database } from "@nightshift/db";
import type { StartRunInput } from "../contract";
import type { ProjectFlows } from "../flows";
import type { RunLog, RunTrigger } from "../log";
import type { RunSummary } from "../read";
import type { RunStatus } from "../run-status";
import type { UsageNotes } from "../usage";
import {
	createScheduleTicker,
	DEFAULT_SCHEDULE_TICK_MS,
} from "./adapters/in/schedule-ticker";
import { drizzleScheduleLog } from "./adapters/out/drizzle-schedule-log";
import { fireDueSchedules } from "./application/fire-due-schedules";
import type { ScheduledRuns, ScheduleLog } from "./application/ports";
import {
	createScheduleWatch,
	type MissedScheduleTime,
	type ScheduleWatch,
} from "./domain/schedule-watch";

/**
 * The scheduler, as the engine still makes it: a facade over the tick's
 * use case (`application/fire-due-schedules.ts`) and its ticker
 * (`adapters/in/schedule-ticker.ts`). It goes when `wire.ts` binds them.
 */

export type SchedulerDeps = {
	db: Database;
	now: () => number;
	/** How often it looks for due schedules. Default `DEFAULT_SCHEDULE_TICK_MS`. */
	tickMs?: number;
	/** Appends `ScheduleFired` and `ScheduleSkipped`. */
	log: RunLog;
	/** The projects a person has not removed, with their folder on this computer. */
	projects(): Promise<{ id: string }[]>;
	/** The schedules of each project. */
	flows: Pick<ProjectFlows, "schedules">;
	/** Starts a run of a flow file, with the trigger stored in `RunStarted`. */
	startRun(input: StartRunInput, trigger: RunTrigger): Promise<RunSummary>;
	/** The run's status, or null when the log knows no such run. */
	runStatus(runId: string): Promise<RunStatus | null>;
	/** Read on every tick: false skips the tick, like a pause of every schedule. Default on. */
	enabled?: () => boolean;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
	/**
	 * Whether this Device fires the schedule: the Space's Host, else the one
	 * Device of a Space without a Host, so a schedule every Clone reads
	 * fires once, and runs it there (ADR 15). Default:
	 * every schedule fires here.
	 */
	firesHere?: (projectId: string) => Promise<boolean>;
	/**
	 * A cron time was missed by more than its schedule allows, after its
	 * `ScheduleSkipped`. Not called for a pause or for an earlier run that
	 * still runs.
	 */
	missed?: (time: MissedScheduleTime) => void;
};

export type Scheduler = {
	/** Ticks now and then every `tickMs`, until `stop` or the signal aborts. */
	start(signal?: AbortSignal): void;
	stop(): void;
	/** One pass over every project. Ticks never overlap: a second call waits for the running one. */
	tick(): Promise<void>;
	/**
	 * Holds the ticks: none starts a run until the release. Resolves once
	 * the tick under way ended, so its runs are in the log. The release
	 * ticks at once when the scheduler runs, and is safe to call twice.
	 */
	hold(): Promise<() => void>;
	/** The schedule facts of the log, as the tick reads and writes them. */
	log: ScheduleLog;
	/** The watch of this engine: it began when the scheduler was made. */
	watch: ScheduleWatch;
	/** The runs a schedule starts and asks about. */
	runs: Pick<ScheduledRuns, "start" | "status">;
};

export function createScheduler(deps: SchedulerDeps): Scheduler {
	const { now } = deps;
	/** It begins now: a cron time before this moment fell while the daemon was down. */
	const watch = createScheduleWatch(now());
	const log = drizzleScheduleLog({ db: deps.db, log: deps.log });
	const runs = { start: deps.startRun, status: deps.runStatus };

	const ticker = createScheduleTicker({
		tickMs: deps.tickMs ?? DEFAULT_SCHEDULE_TICK_MS,
		fire: fireDueSchedules({
			log,
			switch: { on: () => deps.enabled?.() ?? true },
			clock: now,
			projects: {
				all: () => deps.projects(),
				firesHere: async (projectId) =>
					deps.firesHere ? deps.firesHere(projectId) : true,
			},
			store: {
				list: (projectId, options) => deps.flows.schedules(projectId, options),
			},
			runs,
			notices: { missed: (time) => deps.missed?.(time) },
			...(deps.usage ? { usage: deps.usage } : {}),
			watch,
		}),
	});

	return {
		start: ticker.start,
		stop: ticker.stop,
		tick: ticker.tick,
		hold: ticker.hold,
		log,
		watch,
		runs,
	};
}
