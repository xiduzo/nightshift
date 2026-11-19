import type { Database } from "@nightshift/db";
import type { DeviceDirectory } from "./contract";
import type { RunSettings } from "./device-config";
import type { EngineOptions } from "./engine-options";
import type { RunLog } from "./log";
import type { Projects } from "./projects";
import { type ScheduleMissed, wireSchedules } from "./schedules";
import { createPullRequestScores, createPullRequestWatch } from "./scores";

type SchedulesDeps = Parameters<typeof wireSchedules>[0];

/** A missed cron time as the slice tells it: without the Space of its project. */
type MissedTime = Omit<ScheduleMissed, "spaceId">;

type MissedListener = (missed: ScheduleMissed) => void;
type ChangedListener = (spaceId: string, projectId: string) => Promise<void>;

/**
 * What the schedules slice tells the rest of Night Shift, and who hears
 * it: the block below fills the slice's notices port with `notices`, and
 * `engine.ts` offers the two subscriptions on `Engine` (`onScheduleMissed`,
 * `onSchedulesChanged`). The daemon's notifications listen.
 */
export function createScheduleNotices(deps: {
	/** The Space of a project. Throws for a project this Replica does not have. */
	spaceOf(projectId: string): Promise<string>;
}) {
	const missedListeners = new Set<MissedListener>();
	const changedListeners = new Set<ChangedListener>();

	return {
		/** What the schedules slice calls. */
		notices: {
			/**
			 * A cron time was missed by more than its schedule allows. Tells
			 * the listeners with the Space of the project. It does not wait,
			 * and it never throws: the scheduler goes on.
			 */
			missed(time: MissedTime): void {
				void deps
					.spaceOf(time.projectId)
					.then((spaceId) => {
						for (const listener of [...missedListeners]) {
							listener({ ...time, spaceId });
						}
					})
					.catch((error) =>
						console.error("[schedules] could not tell of a missed time", error),
					);
			},
			/**
			 * A project's schedules changed without a run (a pause tonight).
			 * Waits for each listener, in the order they came. A listener
			 * that fails fails the request that made the change.
			 */
			async changed(spaceId: string, projectId: string): Promise<void> {
				for (const listener of [...changedListeners]) {
					await listener(spaceId, projectId);
				}
			},
		},
		/** `Engine.onScheduleMissed`. */
		onMissed(listener: MissedListener): () => void {
			missedListeners.add(listener);
			return () => missedListeners.delete(listener);
		},
		/** `Engine.onSchedulesChanged`. */
		onChanged(listener: ChangedListener): () => void {
			changedListeners.add(listener);
			return () => changedListeners.delete(listener);
		},
	};
}

/**
 * The schedules block of the engine's composition (`wire.ts`): the
 * schedules slice (`schedules/`), what it tells and who listens
 * (`createScheduleNotices`, above), and the pull request scores (`scores/`).
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
