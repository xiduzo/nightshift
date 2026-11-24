import { Refusal } from "@nightshift/refusal";
import { instant, lastDays, now } from "@nightshift/time";
import {
	createRunBus,
	type Derive,
	type DerivedStep,
	type EngineEventType,
	type EnginePayloads,
	foldRun,
	type LoggedEvent,
	type RunRow,
	type RunState,
	type TranscriptEntry,
} from "../../../../log";
import {
	type AnsweredGate,
	costFields,
	deriveSteps,
	inboxOrder,
	NIGHT_RANGES,
	type OpenGate,
	type ProjectRuns,
	parseRunFlow,
	type RunDetail,
	type RunPage,
	type RunStreamItem,
	type RunWalker,
	runDeviceId,
	runFacts,
	runTrace,
	toSummary,
} from "../../../../read";
import { isTestRun } from "../../../../run-status";
import type { RunViews } from "../../application/ports";
import type { DrizzleRunViewsDeps } from "./drizzle-run-views";

/** What the views read besides the rows and the logs: the same as the real adapter's. */
export type RunViewsNeighbours = Pick<
	DrizzleRunViewsDeps,
	"walkers" | "pendingCommands" | "stepEntries" | "ownEntries" | "deviceId"
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

type Page = RunDetail["steps"][number];

/** A step as the twin shows it: it has no sessions, no items and no sleeps. */
const pageOf = (step: DerivedStep, device: RunWalker | null): Page => ({
	id: step.id,
	nodeId: step.nodeId,
	nodeType: step.nodeType,
	visit: step.visit,
	startedAt: step.startedAt,
	endedAt: step.endedAt,
	outcome: step.outcome,
	outputs: step.outputs,
	error: step.error,
	scope: step.scope,
	items: [],
	sessions: [],
	...costFields(step.cost),
	device,
	gate: null,
});

/** The row as a Gate names its run. */
const gateRun = (row: RunRow, projectName: string) => ({
	spaceId: row.spaceId,
	runId: row.id,
	runTitle: row.title,
	flowName: row.flowName,
	projectId: row.projectId,
	projectName,
});

/** How many of these runs have each status. */
function countBy<T extends string>(statuses: T[]): Partial<Record<T, number>> {
	const counts: Partial<Record<T, number>> = {};
	for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
	return counts;
}

/**
 * The views of runs in memory: the rows, the projects and each run's log,
 * folded as the run log folds them (`foldRun`). The twin makes simple pages
 * of its own: what the contract asks, and no more. A test adds a project
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
	const stepsOf = (runId: string) => deriveSteps(stateOf(runId));
	const derive = <T>(runIds: readonly string[], fn: Derive<T>) =>
		new Map(runIds.map((id) => [id, fn(stateOf(id))]));

	/** Names the Devices a Space's runs name. */
	async function namer(spaceId: string, ids: readonly (string | null)[]) {
		const known = await deps.walkers(
			spaceId,
			ids.filter((id): id is string => id !== null),
		);
		return (id: string): RunWalker =>
			known.get(id) ?? { id, name: null, thisDevice: false };
	}

	/** These steps of a run as its pages show them. */
	async function pagesOf(row: RunRow, steps: readonly DerivedStep[]) {
		const deviceOf = await namer(
			row.spaceId,
			steps.map((step) => step.deviceId),
		);
		return steps.map((step) =>
			pageOf(step, step.deviceId === null ? null : deviceOf(step.deviceId)),
		);
	}

	function stepOf(runId: string, stepId: string): DerivedStep {
		const step = stepsOf(runId).find(({ id }) => id === stepId);
		if (step) return step;
		throw new Refusal(
			"not-found",
			"Night Shift cannot find this step of the run.",
		);
	}

	/** The actions that wait for the Walker of a run, when that is not this computer. */
	const waitingFor = async (runId: string, walker: RunWalker) =>
		walker.thisDevice
			? []
			: ((await deps.pendingCommands([runId])).get(runId) ?? []);

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
	function runsOfProjects(spaceId: string, since?: number) {
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
			const counts = new Map<string, ProjectRuns>();
			const inSpace = [...rows.values()]
				.filter((row) => row.spaceId === spaceId)
				.sort(newestFirst((row) => instant(row.createdAt)));
			for (const projectId of new Set(inSpace.map((row) => row.projectId))) {
				const runs = inSpace
					.filter((row) => row.projectId === projectId)
					.map((row) => ({ row, facts: runFacts(stateOf(row.id)) }));
				const [last] = runs;
				if (!last) continue;
				const tests = runs.filter((run) => isTestRun(run.facts));
				const wakes = runs.flatMap((run) => run.facts.wakeAt ?? []);
				counts.set(projectId, {
					total: runs.length,
					statuses: countBy(runs.map((run) => run.facts.status)),
					...(tests.length > 0
						? { tests: countBy(tests.map((run) => run.facts.status)) }
						: {}),
					last: {
						id: last.row.id,
						title: last.row.title,
						createdAt: instant(last.row.createdAt),
					},
					nextWakeAt: wakes.length > 0 ? Math.min(...wakes) : null,
					nights: NIGHT_RANGES.map((nights) => {
						const [first = read.now] = lastDays(
							nights,
							read.now,
							read.timeZone,
						);
						const counted = runs.filter(
							(run) =>
								!tests.includes(run) && instant(run.row.createdAt) >= first,
						);
						return {
							nights,
							total: counted.length,
							statuses: countBy(counted.map((run) => run.facts.status)),
						};
					}),
				});
			}
			return counts;
		},

		async getRun(row: RunRow): Promise<RunDetail> {
			const deviceOf = await namer(row.spaceId, [
				row.walkerId,
				runDeviceId(row),
			]);
			const walker = deviceOf(row.walkerId);
			return {
				...toSummary(
					row,
					runFacts(stateOf(row.id)),
					namesOf([row.startedBy]),
					walker,
					deviceOf(runDeviceId(row)),
				),
				flow: parseRunFlow(row),
				calledFlows: {},
				flowRevision: row.flowRevision,
				steps: await pagesOf(row, stepsOf(row.id)),
				traversals: {},
				calledTraversals: [],
				takeOverCommand: null,
				resumes: [],
				commands: await waitingFor(row.id, walker),
				handOffs: [],
				variables: [],
				leases: [],
				services: [],
			};
		},

		async getStep(row: RunRow, stepId: string) {
			const step = stepOf(row.id, stepId);
			const device =
				step.deviceId === null
					? null
					: (await namer(row.spaceId, [step.deviceId]))(step.deviceId);
			return { ...pageOf(step, device), sessions: [], items: [] };
		},

		async stepTranscript(row: RunRow, stepId: string, signal: AbortSignal) {
			const at = { spaceId: row.spaceId, runId: row.id, stepId };
			if (stepOf(row.id, stepId).endedAt === null) {
				const entries = await deps.ownEntries(at);
				return { entries, holds: "so-far" as const };
			}
			const entries: TranscriptEntry[] = [];
			for await (const entry of deps.stepEntries(at, 0, signal)) {
				entries.push(entry);
			}
			return { entries, holds: signal.aborted ? "cut" : "whole" } as const;
		},

		async runStatus(runId: string) {
			return logs.has(runId) ? stateOf(runId).status : null;
		},

		async runHere(runId: string) {
			const row = rows.get(runId);
			if (!row) return null;
			const { status, wakeAt, waitReason } = runFacts(stateOf(runId));
			const here = (id: string) => id === walkerId || id === deps.deviceId;
			return {
				id: runId,
				status,
				wakeAt,
				waitReason,
				walkedHere: here(row.walkerId),
				stepsHere: here(runDeviceId(row)),
			};
		},

		async trace(runId: string) {
			return runTrace(stateOf(runId));
		},

		async listGates(spaceId: string) {
			const gates: OpenGate[] = [];
			for (const { run, projectName } of runsOfProjects(spaceId)) {
				const { gate } = stateOf(run.id);
				if (!gate) continue;
				const walker = (await namer(spaceId, [run.walkerId]))(run.walkerId);
				const commands = await waitingFor(run.id, walker);
				gates.push({
					...gateRun(run, projectName),
					...gate,
					walker,
					answerPending: commands.some(({ kind }) => kind === "gate.resolve"),
				});
			}
			return inboxOrder(gates);
		},

		async listAnsweredGates(spaceId: string, since: number) {
			const gates: AnsweredGate[] = [];
			for (const { run, projectName } of runsOfProjects(spaceId, since)) {
				const state = stateOf(run.id);
				for (const step of stepsOf(run.id)) {
					for (const wait of step.gateWaits) {
						if (wait.to === null || wait.to < since) continue;
						const said = step.openings[wait.opening]?.end?.payload.outputs.note;
						gates.push({
							...gateRun(run, projectName),
							stepId: step.id,
							nodeId: step.nodeId,
							question: wait.question,
							choices: wait.choices,
							urgency: wait.urgency,
							brief: wait.brief,
							openedAt: wait.from,
							closedAt: wait.to,
							answeredBy: wait.answeredBy,
							answer: wait.answer,
							note:
								wait.answeredBy === "person" &&
								typeof said === "string" &&
								said.trim() !== ""
									? said
									: null,
							run: {
								status: state.status,
								result: state.end?.result ?? null,
							},
						});
					}
				}
			}
			return gates.sort((x, y) => y.closedAt - x.closedAt);
		},

		/** The transcript so far goes out once, after the steps: no later entry follows. */
		async *watch(
			row: RunRow,
			signal: AbortSignal,
			afterSeq: number,
		): AsyncGenerator<RunStreamItem> {
			if (signal.aborted) return;
			const changed: string[] = [];
			let moved = true;
			let wake = () => {};
			const off = bus.subscribe(row.id, (item) => {
				if (item.kind === "step-changed") changed.push(item.stepId);
				moved = true;
				wake();
			});
			const stop = () => wake();
			signal.addEventListener("abort", stop, { once: true });
			try {
				let { status } = stateOf(row.id);
				yield { kind: "status", status };
				const steps = stepsOf(row.id);
				for (const step of await pagesOf(row, steps)) {
					yield { kind: "step", step };
				}
				const entries: TranscriptEntry[] = [];
				for (const { id: stepId } of steps) {
					const at = { spaceId: row.spaceId, runId: row.id, stepId };
					for await (const entry of deps.stepEntries(at, afterSeq, signal)) {
						if (entry.seq > afterSeq) entries.push(entry);
					}
				}
				for (const entry of entries.sort((x, y) => x.seq - y.seq)) {
					yield { kind: "transcript", entry };
				}
				while (!signal.aborted) {
					moved = false;
					const stepId = changed.shift();
					const step = stepsOf(row.id).find(({ id }) => id === stepId);
					if (step) {
						for (const page of await pagesOf(row, [step])) {
							yield { kind: "step", step: page };
						}
					}
					const next = stateOf(row.id).status;
					if (next !== status) {
						status = next;
						yield { kind: "status", status };
					}
					if (moved || changed.length > 0 || signal.aborted) continue;
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
			} finally {
				off();
				signal.removeEventListener("abort", stop);
			}
		},
	};
	return twin satisfies RunViews;
}

export type InMemoryRunViews = ReturnType<typeof inMemoryRunViews>;
