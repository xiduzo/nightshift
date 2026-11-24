import type { JsonValue, Schedule, WebhookEvent } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import {
	type InMemoryAccess,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import type { Actor, StartRunInput } from "../../../contract";
import type { RunTrigger } from "../../../log";
import { PROJECT_NOT_FOUND } from "../../../projects/keep";
import type { RunSummary } from "../../../read";
import type { RunStatus } from "../../../run-status";
import type {
	Clock,
	PausedHere,
	PullRequestScorer,
	ScheduledProjects,
	ScheduledRuns,
	ScheduleNotices,
	ScheduleOffers,
	ScheduleSwitch,
	WebhookSecrets,
} from "../../application/ports";
import type { MissedScheduleTime } from "../../domain/schedule-watch";
import {
	type InMemoryScheduleStore,
	inMemoryScheduleStore,
} from "./in-memory-schedule-store";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and `inMemorySchedulePorts`,
 * which gives a use-case test every port of the slice at once. Test code:
 * production code never imports this file.
 */

/** The schedules paused on this computer, by project. */
export function inMemoryPausedHere(
	paused: Record<string, string[]>,
): PausedHere & { paused: Record<string, string[]> } {
	return {
		paused,
		of: async (projectId) => new Set(paused[projectId] ?? []),
		async ended(projectId, ids) {
			paused[projectId] = (paused[projectId] ?? []).filter(
				(id) => !ids.includes(id),
			);
		},
	};
}

/** A clock a test sets. */
export type InMemoryClock = Clock & { set(at: number): void };

export function inMemoryClock(at: number): InMemoryClock {
	let now = at;
	const clock: InMemoryClock = Object.assign(() => now, {
		set(next: number) {
			now = next;
		},
	});
	return clock;
}

/** The runs a schedule started, and what a test says of them. */
export type InMemoryScheduledRuns = ScheduledRuns & {
	/** Every start that worked, in order. */
	started: { input: StartRunInput; trigger: RunTrigger; run: RunSummary }[];
	/** Every signal that was sent, in order. */
	signals: {
		projectId: string;
		signal: { name: string; key: string | null; data: JsonValue };
	}[];
	/** Who asked to see runs, in order. */
	shown: { spaceId: string; actor: Actor }[];
	/** A run's status from now on. A started run is `running` until a test says otherwise. Null: the run is gone. */
	setStatus(runId: string, status: RunStatus | null): void;
	/** The next start throws this. */
	failNextStart(error: unknown): void;
	/** Every signal throws this. */
	failSignals(error: unknown): void;
	/** How many runs each signal wakes from now on. Default 0. */
	wakes(count: number): void;
	/** From now on a run is shown without its worktree path, as to an actor who does not own its Device. */
	hidePaths(): void;
};

export function inMemoryScheduledRuns(): InMemoryScheduledRuns {
	const statuses = new Map<string, RunStatus | null>();
	let startFailure: { error: unknown } | null = null;
	let signalFailure: { error: unknown } | null = null;
	let woken = 0;
	let hidden = false;
	const runs: InMemoryScheduledRuns = {
		started: [],
		signals: [],
		shown: [],
		setStatus: (runId, status) => {
			statuses.set(runId, status);
		},
		failNextStart: (error) => {
			startFailure = { error };
		},
		failSignals: (error) => {
			signalFailure = { error };
		},
		wakes: (count) => {
			woken = count;
		},
		hidePaths: () => {
			hidden = true;
		},

		async start(input, trigger) {
			if (startFailure) {
				const { error } = startFailure;
				startFailure = null;
				throw error;
			}
			const id = `run-${runs.started.length + 1}`;
			const run = {
				id,
				projectId: input.projectId,
				trigger,
				flowName: "flowName" in input ? input.flowName : null,
				inputs: input.inputs ?? {},
				stopAt: input.stopAt ?? null,
				status: "running",
				worktreePath: `/worktrees/${id}`,
			} as RunSummary;
			statuses.set(id, "running");
			runs.started.push({ input, trigger, run });
			return run;
		},
		async status(runId) {
			return statuses.get(runId) ?? null;
		},
		async signal(projectId, signal) {
			if (signalFailure) throw signalFailure.error;
			runs.signals.push({ projectId, signal });
			return woken;
		},
		async shownTo(spaceId, actor) {
			runs.shown.push({ spaceId, actor });
			return async (run) => (hidden ? { ...run, worktreePath: "" } : run);
		},
	};
	return runs;
}

/** The projects of a test, each in its Space. */
export type InMemoryScheduledProjects = ScheduledProjects & {
	/** Adds a project. It has a Clone here and fires here, unless the test says otherwise. */
	add(project: {
		id: string;
		spaceId: string;
		hasFolder?: boolean;
		clonedHere?: boolean;
		firesHere?: boolean;
	}): void;
	/** Removes a project, as a person does. */
	remove(projectId: string): void;
};

export function inMemoryScheduledProjects(): InMemoryScheduledProjects {
	const projects = new Map<
		string,
		{
			spaceId: string;
			hasFolder: boolean;
			clonedHere: boolean;
			firesHere: boolean;
		}
	>();
	return {
		add({ id, spaceId, hasFolder, clonedHere, firesHere }) {
			projects.set(id, {
				spaceId,
				hasFolder: hasFolder ?? true,
				clonedHere: clonedHere ?? true,
				firesHere: firesHere ?? true,
			});
		},
		remove(projectId) {
			projects.delete(projectId);
		},

		async all() {
			return [...projects.keys()].map((id) => ({ id }));
		},
		async inSpace(projectId, spaceId) {
			const project = projects.get(projectId);
			if (!project || project.spaceId !== spaceId) {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			return { hasFolder: project.hasFolder, clonedHere: project.clonedHere };
		},
		async firesHere(projectId) {
			const project = projects.get(projectId);
			if (!project) throw new Refusal("not-found", PROJECT_NOT_FOUND);
			return project.firesHere;
		},
	};
}

/** The Offer rule of a test: it writes the schedules as they are, unless the test says otherwise. */
export type InMemoryScheduleOffers = ScheduleOffers & {
	/** Every save that asked, in order. */
	asked: {
		projectId: string;
		spaceId: string;
		actor: Actor | undefined;
		schedules: readonly Schedule[];
	}[];
	/** From now on each schedule is written for this Person, as one on another Person's Device is. */
	writeFor(personId: string): void;
	/** From now on the rule refuses with this. */
	refuse(error: unknown): void;
};

export function inMemoryScheduleOffers(): InMemoryScheduleOffers {
	let person: string | null = null;
	let refusal: { error: unknown } | null = null;
	const offers: InMemoryScheduleOffers = {
		asked: [],
		writeFor: (personId) => {
			person = personId;
		},
		refuse: (error) => {
			refusal = { error };
		},
		async schedulesWithOffers(project, spaceId, actor, schedules) {
			offers.asked.push({ projectId: project.id, spaceId, actor, schedules });
			if (refusal) throw refusal.error;
			return schedules.map((schedule) =>
				person === null ? schedule : { ...schedule, person },
			);
		},
	};
	return offers;
}

/** The pull request scorer of a test: it counts what it takes. */
export type InMemoryPullRequestScorer = PullRequestScorer & {
	taken: { projectId: string; webhook: WebhookEvent }[];
	/** From now on it throws this. */
	fail(error: unknown): void;
};

export function inMemoryPullRequestScorer(): InMemoryPullRequestScorer {
	let failure: { error: unknown } | null = null;
	const scorer: InMemoryPullRequestScorer = {
		taken: [],
		fail: (error) => {
			failure = { error };
		},
		async take(projectId, webhook) {
			if (failure) throw failure.error;
			scorer.taken.push({ projectId, webhook });
			return 1;
		},
	};
	return scorer;
}

/** The secrets of a test, by name. */
export type InMemoryWebhookSecrets = WebhookSecrets & {
	set(name: string, value: string): void;
	/** Every secret that was asked for, in order. */
	asked: { name: string; projectId: string }[];
};

export function inMemoryWebhookSecrets(): InMemoryWebhookSecrets {
	const values = new Map<string, string>();
	const secrets: InMemoryWebhookSecrets = {
		asked: [],
		set: (name, value) => {
			values.set(name, value);
		},
		async value(name, projectId) {
			secrets.asked.push({ name, projectId });
			return values.get(name);
		},
	};
	return secrets;
}

/** The two switches of a test. Both on at first. */
export type InMemoryScheduleSwitch = ScheduleSwitch & {
	/** The Settings switch. */
	turn(on: boolean): void;
	/** Whether the engine started its scheduler at all. */
	start(started: boolean): void;
};

export function inMemoryScheduleSwitch(): InMemoryScheduleSwitch {
	let on = true;
	let started = true;
	return {
		on: () => on,
		started: () => started,
		turn: (next) => {
			on = next;
		},
		start: (next) => {
			started = next;
		},
	};
}

/** What a test hears from the slice. */
export type InMemoryScheduleNotices = ScheduleNotices & {
	/** The missed times that were told, in order. */
	misses: MissedScheduleTime[];
	/** The changes of schedules that were told, in order. */
	changes: { spaceId: string; projectId: string }[];
	/** From now on telling of a miss throws this. */
	failMissed(error: unknown): void;
	/** From now on telling of a change throws this. */
	failChanged(error: unknown): void;
};

export function inMemoryScheduleNotices(): InMemoryScheduleNotices {
	let failure: { error: unknown } | null = null;
	let changeFailure: { error: unknown } | null = null;
	const notices: InMemoryScheduleNotices = {
		misses: [],
		changes: [],
		failMissed: (error) => {
			failure = { error };
		},
		failChanged: (error) => {
			changeFailure = { error };
		},
		async changed(spaceId, projectId) {
			if (changeFailure) throw changeFailure.error;
			notices.changes.push({ spaceId, projectId });
		},
		missed(time) {
			if (failure) throw failure.error;
			notices.misses.push(time);
		},
	};
	return notices;
}

/** The ports of the slice that are no database, in memory. */
export type InMemorySchedulePorts = {
	clock: InMemoryClock;
	access: InMemoryAccess;
	store: InMemoryScheduleStore;
	runs: InMemoryScheduledRuns;
	projects: InMemoryScheduledProjects;
	offers: InMemoryScheduleOffers;
	scorer: InMemoryPullRequestScorer;
	secrets: InMemoryWebhookSecrets;
	switch: InMemoryScheduleSwitch;
	notices: InMemoryScheduleNotices;
};

/** The ports of the slice that are no database, in memory, with the clock at `at`. */
export function inMemorySchedulePorts(at: number): InMemorySchedulePorts {
	return {
		clock: inMemoryClock(at),
		access: inMemoryAccess(),
		store: inMemoryScheduleStore(),
		runs: inMemoryScheduledRuns(),
		projects: inMemoryScheduledProjects(),
		offers: inMemoryScheduleOffers(),
		scorer: inMemoryPullRequestScorer(),
		secrets: inMemoryWebhookSecrets(),
		switch: inMemoryScheduleSwitch(),
		notices: inMemoryScheduleNotices(),
	};
}
