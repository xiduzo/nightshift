import { instant, now } from "@nightshift/time";
import {
	createRunBus,
	type Derive,
	type EngineEventType,
	type EnginePayloads,
	foldRun,
	type LoggedEvent,
	type RunRow,
	type RunState,
} from "../../../../log";
import {
	deriveSteps,
	type RunPage,
	type RunWalker,
	runDeviceId,
	runFacts,
	runTrace,
	toSummary,
} from "../../../../read";
import type { RunViews } from "../../application/ports";
import type { DrizzleRunViewsDeps } from "./drizzle-run-views";
import {
	answeredFacts,
	answeredGatesOf,
	countProjectRuns,
	type DeviceNamer,
	devicesOfRun,
	knownStatus,
	openGate,
	openGatesOf,
	type RunOfProject,
	runHereOf,
	stepOf,
	toRunDetail,
	toStepDetail,
	walkerOf,
} from "./run-pages";
import { type RunWatchPorts, savedTranscript, watchRun } from "./run-watch";

/** What the views read besides the rows and the logs: the same as the real adapter's. */
export type RunViewsNeighbours = Pick<
	DrizzleRunViewsDeps,
	| "harnessOf"
	| "walkers"
	| "pendingCommands"
	| "stepEntries"
	| "ownEntries"
	| "deviceId"
>;

/** The Walker the in-memory runs name when a test gives none: this computer. */
export const THIS_COMPUTER = "this-computer";

/** One event for a run's log, as a test writes it. */
export type RunEvent<T extends EngineEventType = EngineEventType> = {
	type: T;
	payload: EnginePayloads[T];
	runId: string;
	stepId?: string | null;
	/** When it happened. Default: now. */
	at?: number;
};

/** What a test does not set: every Walker is this computer, no Command waits, no transcript. */
function neighboursOf(
	given: Partial<RunViewsNeighbours>,
	walkerId: string,
): RunViewsNeighbours {
	return {
		deviceId: walkerId,
		harnessOf: () => undefined,
		walkers: async (_spaceId, ids) =>
			new Map(
				ids.map((id) => [id, { id, name: null, thisDevice: id === walkerId }]),
			),
		pendingCommands: async () => new Map(),
		stepEntries: async function* () {},
		ownEntries: async () => [],
		...given,
	};
}

/**
 * The views of runs in memory: the rows, the projects and each run's log,
 * folded as the run log folds them (`foldRun`). Every page is made by the
 * same functions as the real adapter's (`run-pages.ts`, `run-watch.ts`):
 * the twin differs in where the rows come from. A test adds a project
 * (`project`), a run (`add`) and its events (`append`), and names a
 * Person (`name`).
 */
export function inMemoryRunViews(
	given: Partial<RunViewsNeighbours> = {},
	walkerId = THIS_COMPUTER,
) {
	const deps = neighboursOf(given, walkerId);
	const rows = new Map<string, RunRow>();
	const logs = new Map<string, LoggedEvent[]>();
	const projects = new Map<string, { name: string; removed: boolean }>();
	const names = new Map<string, string>();
	const bus = createRunBus();
	let seq = 0;

	const stateOf = (runId: string): RunState => foldRun(logs.get(runId) ?? []);
	const log = {
		async derive<T>(runIds: readonly string[], fn: Derive<T>) {
			return new Map(runIds.map((id) => [id, fn(stateOf(id))]));
		},
		async events(runId: string) {
			return [...(logs.get(runId) ?? [])];
		},
	};
	const derive = <T>(runIds: readonly string[], fn: Derive<T>) =>
		new Map(runIds.map((id) => [id, fn(stateOf(id))]));

	async function namer(
		spaceId: string,
		ids: readonly (string | null)[],
	): Promise<DeviceNamer> {
		const known = await deps.walkers(
			spaceId,
			ids.filter((id): id is string => id !== null),
		);
		return (id) => walkerOf(known, id);
	}
	const watching: RunWatchPorts = {
		log,
		bus,
		stepEntries: deps.stepEntries,
		ownEntries: deps.ownEntries,
		namer,
	};

	/** The names of these Persons that the twin knows. */
	const namesOf = (ids: readonly (string | null)[]) =>
		new Map(
			ids.flatMap((id) => {
				const name = id === null ? undefined : names.get(id);
				return id !== null && name !== undefined ? [[id, name] as const] : [];
			}),
		);

	/** The Space's runs, newest first by `key`, then by id. */
	const newestFirst =
		(key: (row: RunRow) => number) =>
		(a: RunRow, b: RunRow): number =>
			key(b) - key(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

	/** The runs of the Space of projects not removed, with their project's name. */
	function runsOfProjects(spaceId: string, since?: number): RunOfProject[] {
		return [...rows.values()].flatMap((run) => {
			const project = projects.get(run.projectId);
			if (run.spaceId !== spaceId || !project || project.removed) return [];
			if (since !== undefined && instant(run.createdAt) < since) return [];
			return [{ run, projectName: project.name }];
		});
	}

	const twin = {
		/** Tells the watchers of a run that something changed. */
		bus,
		/** A project of that id and name. A removed one has no Gates in the inbox. */
		project(id: string, name = id, removed = false) {
			projects.set(id, { name, removed });
		},
		/** Adds a run's row. */
		add(row: RunRow) {
			rows.set(row.id, row);
		},
		/** The row of a run, as access gives it to the reads. */
		row(runId: string): RunRow | undefined {
			return rows.get(runId);
		},
		/** Changes a run's row, as a later write of the row does. */
		change(runId: string, changes: Partial<RunRow>) {
			const row = rows.get(runId);
			if (row) rows.set(runId, { ...row, ...changes });
		},
		/** The name of a Person, as this Replica knows it. */
		name(personId: string, name: string) {
			names.set(personId, name);
		},
		/** Appends an event to a run's log and returns it as logged. */
		append<T extends EngineEventType>(event: RunEvent<T>): LoggedEvent {
			const logged = {
				seq: ++seq,
				runId: event.runId,
				stepId: event.stepId ?? null,
				sessionId: null,
				type: event.type,
				payload: event.payload,
				at: event.at ?? now(),
			} as LoggedEvent;
			logs.set(event.runId, [...(logs.get(event.runId) ?? []), logged]);
			return logged;
		},

		async listRuns(spaceId: string, projectId?: string, page: RunPage = {}) {
			const { cursor, statuses } = page;
			const limit = statuses ? undefined : page.limit;
			const byActivity = page.order === "activity";
			const key = (row: RunRow) =>
				byActivity
					? (stateOf(row.id).lastAt ?? instant(row.createdAt))
					: instant(row.createdAt);
			const from = cursor
				? byActivity
					? (cursor.lastActivityAt ?? cursor.createdAt)
					: cursor.createdAt
				: 0;
			const read = [...rows.values()]
				.filter(
					(row) =>
						row.spaceId === spaceId &&
						(!projectId || row.projectId === projectId) &&
						(!cursor ||
							key(row) < from ||
							(key(row) === from && row.id < cursor.id)),
				)
				.sort(newestFirst(key))
				.slice(0, limit);
			const facts = derive(
				read.map((r) => r.id),
				runFacts,
			);
			const shown = statuses
				? read
						.filter((r) => {
							const status = facts.get(r.id)?.status;
							return status !== undefined && statuses.includes(status);
						})
						.slice(0, page.limit)
				: read;
			const deviceOf = await namer(
				spaceId,
				shown.flatMap((r) => [r.walkerId, runDeviceId(r)]),
			);
			const known = namesOf(shown.map((r) => r.startedBy));
			return shown.map((row) =>
				toSummary(
					row,
					facts.get(row.id) ?? runFacts(foldRun([])),
					known,
					deviceOf(row.walkerId),
					deviceOf(runDeviceId(row)),
				),
			);
		},

		async projectRuns(spaceId: string, read = { now: now(), timeZone: "UTC" }) {
			const inSpace = [...rows.values()]
				.filter((row) => row.spaceId === spaceId)
				.sort(newestFirst((row) => instant(row.createdAt)));
			const facts = derive(
				inSpace.map((r) => r.id),
				runFacts,
			);
			return countProjectRuns(inSpace, facts, read);
		},

		async getRun(row: RunRow) {
			const state = stateOf(row.id);
			const deviceOf = await namer(row.spaceId, devicesOfRun(row, state));
			const walker: RunWalker = deviceOf(row.walkerId);
			return toRunDetail(
				row,
				state,
				runFacts(state),
				deps.harnessOf,
				namesOf([row.startedBy]),
				walker,
				walker.thisDevice
					? []
					: ((await deps.pendingCommands([row.id])).get(row.id) ?? []),
				deviceOf,
			);
		},

		async getStep(row: RunRow, stepId: string) {
			const step = stepOf(deriveSteps(stateOf(row.id)), stepId);
			return toStepDetail(step, await namer(row.spaceId, [step.deviceId]));
		},

		stepTranscript: (row: RunRow, stepId: string, signal: AbortSignal) =>
			savedTranscript(watching, row, stepId, signal),

		async runStatus(runId: string) {
			return knownStatus(stateOf(runId));
		},

		async runHere(runId: string) {
			const row = rows.get(runId);
			if (!row) return null;
			return runHereOf(
				runId,
				row,
				runFacts(stateOf(runId)),
				walkerId,
				deps.deviceId,
			);
		},

		async trace(runId: string) {
			return runTrace(stateOf(runId));
		},

		async listGates(spaceId: string) {
			const inSpace = runsOfProjects(spaceId);
			const facts = derive(
				inSpace.map((r) => r.run.id),
				runFacts,
			);
			const open = derive(
				inSpace
					.map((r) => r.run.id)
					.filter((id) => facts.get(id)?.status === "waiting"),
				openGate,
			);
			const withGate = inSpace.filter((r) => open.has(r.run.id));
			const walkers = await deps.walkers(
				spaceId,
				withGate.map((r) => r.run.walkerId),
			);
			const pending = await deps.pendingCommands(
				withGate
					.filter((r) => !walkerOf(walkers, r.run.walkerId).thisDevice)
					.map((r) => r.run.id),
			);
			return openGatesOf(inSpace, open, walkers, pending);
		},

		async listAnsweredGates(spaceId: string, since: number) {
			const inSpace = runsOfProjects(spaceId, since);
			return answeredGatesOf(
				inSpace,
				derive(
					inSpace.map((r) => r.run.id),
					answeredFacts,
				),
				since,
			);
		},

		watch: (row: RunRow, signal: AbortSignal, afterSeq: number) =>
			watchRun(watching, row, signal, afterSeq),
	};
	return twin satisfies RunViews;
}

export type InMemoryRunViews = ReturnType<typeof inMemoryRunViews>;
