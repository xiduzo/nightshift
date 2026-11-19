import type { Database } from "@nightshift/db";
import type { DeviceDirectory } from "./contract";
import type { RunSettings } from "./device-config";
import type { EngineOptions } from "./engine-options";
import type { RunLog } from "./log";
import type { Projects } from "./projects";
import { createScheduleNotices } from "./run";
import { wireSchedules } from "./schedules";
import { createPullRequestScores, createPullRequestWatch } from "./scores";

type SchedulesDeps = Parameters<typeof wireSchedules>[0];

/**
 * The schedules block of the engine's composition (`wire.ts`): the
 * schedules slice (`schedules/`), what it tells and who listens
 * (`run/schedule-notices.ts`), and the pull request scores (`scores/`).
 * It starts the scheduler and the morning check when the engine is ready.
 *
 * It gives `schedules`, `notices` and `pullRequestWatch`. The Space move
 * holds `schedules.ticker`. The Space view and the engine read the rest.
 *
 * `runs` is what the slice asks of the run path. The blocks start (R3),
 * views (R2) and recovery (R7) each give one member of it, in `wire.ts`.
 */
export function wireEngineSchedules(deps: {
	db: Database;
	log: RunLog;
	/** The flows slice: the schedules and flows of each project. */
	flows: SchedulesDeps["flows"];
	now(): number;
	/** How often the scheduler looks for due schedules. Default 30 000 ms. */
	tickMs: SchedulesDeps["tickMs"];
	runs: SchedulesDeps["runs"];
	projects: Pick<Projects, "find" | "listInSpace">;
	directory: Pick<DeviceDirectory, "hostedElsewhere">;
	offers: SchedulesDeps["offers"];
	/** `EngineOptions.secret`. Absent: the environment. */
	secret: EngineOptions["secret"];
	settings(): RunSettings;
	/** `EngineOptions.scheduler`. `false`: no scheduler and no morning check. */
	scheduler: EngineOptions["scheduler"];
	usage: EngineOptions["usage"];
	github: EngineOptions["github"];
	/** The engine's lifetime. */
	signal: AbortSignal;
	/** Settles when the engine is ready: the scheduler starts then. */
	ready: Promise<unknown>;
	/** Whether the engine's lifetime ended. */
	disposed(): boolean;
}) {
	const { db, log, now, projects, directory, signal, ready } = deps;

	/** A webhook schedule's pull request scores: the project's runs this computer walks. */
	const pullRequestScores = createPullRequestScores({
		db,
		log,
		now,
		usage: deps.usage,
	});

	/** What the schedules tell, and who listens (`onScheduleMissed`, `onSchedulesChanged`). */
	const scheduleNotices = createScheduleNotices({
		spaceOf: async (projectId) => (await projects.find(projectId)).spaceId,
	});
	/** The schedules of the projects: its watch begins here, while the engine is made. */
	const schedules = wireSchedules({
		log: { db, log },
		flows: deps.flows,
		clock: now,
		tickMs: deps.tickMs,
		runs: deps.runs,
		projects: {
			// Also a project without a Clone here: its runs run on another Device.
			all: () => projects.listInSpace(),
			inSpace: async (projectId, spaceId) => {
				const row = await projects.find(projectId, spaceId);
				return {
					hasFolder: Boolean(row.folder),
					clonedHere: row.repoPath !== null,
				};
			},
			// The Replica that keeps the Space fires every schedule of it (its
			// Host, or the one Device of a Space without one), so one that is
			// always on starts them, and its runs run there (ADR 15). A webhook
			// schedule's webhooks go to the same Replica.
			firesHere: async (projectId) => {
				const row = await projects.find(projectId);
				return !(await directory.hostedElsewhere(row.spaceId));
			},
		},
		offers: deps.offers,
		scorer: {
			take: (projectId, webhook) => pullRequestScores.take(projectId, webhook),
		},
		secrets: {
			value: async (name, projectId) => {
				if (!deps.secret) return process.env[name];
				const { spaceId } = await projects.find(projectId);
				return deps.secret(name, { spaceId, projectId });
			},
		},
		// The Settings switch, and NIGHTSHIFT_SCHEDULER=off.
		switch: {
			on: () => deps.settings().scheduler,
			started: () => deps.scheduler !== false,
		},
		notices: scheduleNotices.notices,
		usage: deps.usage,
	});
	const pullRequestWatch = createPullRequestWatch({
		db,
		log,
		now,
		usage: deps.usage,
		github: deps.github ?? { viewPullRequest: async () => null },
	});
	if (deps.scheduler !== false) {
		const schedulerSignal = deps.scheduler?.signal;
		signal.addEventListener("abort", () => schedules.ticker.stop(), {
			once: true,
		});
		ready.then(
			() => {
				if (deps.disposed()) return;
				schedules.ticker.start(schedulerSignal);
				if (deps.github) pullRequestWatch.everyMorning(signal);
			},
			() => {},
		);
	}

	return { schedules, notices: scheduleNotices, pullRequestWatch };
}
