import { shellQuote } from "@nightshift/agents/harness-facts";
import type { AgentHarness, HarnessName } from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { project, run, step } from "@nightshift/db/schema/nightshift";
import { type Flow, flowSchema, migrateFlow } from "@nightshift/flows";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { RunBus } from "./bus";
import {
	addCost,
	type CostTally,
	type DerivedStep,
	deriveEndedAt,
	deriveGateWaits,
	deriveInputs,
	deriveOpenGate,
	deriveResumes,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	deriveStopAfterStep,
	deriveStopAt,
	deriveTraversals,
	deriveTrigger,
	deriveWarnings,
	type LoggedEvent,
	lastHarnessSession,
	NO_COST,
	type Scope,
	scopeKey,
	sessionCost,
	sumCost,
} from "./events";
import { getRunRow, type RunRow } from "./graph/context";
import { namesOf, runPerson } from "./people";
import type { RunLog } from "./run-log";
import type {
	ItemSummary,
	OpenGate,
	PendingCommand,
	RunDetail,
	RunStatus,
	RunStreamItem,
	RunSummary,
	RunWalker,
	RunWarning,
	StepOutcome,
	StepSummary,
	SubflowRun,
	TranscriptEntry,
} from "./types";

/**
 * The read model: what people see of a run, derived from the event log
 * (design rule: the log is the read model). This module only reads. The
 * pure half (`runFacts`, `toSummary`, `toStepSummary`, `toRunDetail`,
 * `takeOverCommand`, the flow snapshot parsers) turns rows and events into
 * the `types.ts` shapes; `createReadModel` adds the queries that need the
 * database, the run log and the bus (`listRuns`, `getRun`, `listGates`,
 * `runStatus`, `watch`, `untilLogged`).
 *
 * The seam is narrow on purpose: the engine passes `db`, `log`, `bus` and
 * `isActive` and gets the reads back, so the shape of a summary changes in
 * one file (locality), and a test of a derivation needs no engine.
 */

/** The take-over facts of the harness of that name, or none. */
export type HarnessOf = (
	name: HarnessName,
) => Pick<AgentHarness, "takeOverCommand"> | undefined;

/**
 * The command a person runs in the worktree to take over the last harness
 * session, from the harness port's `takeOverCommand`. Null when there is
 * none, when the harness is not built, or when it has no command for it.
 */
export function takeOverCommand(
	worktreePath: string,
	last: { harness: HarnessName; harnessSessionId: string } | null | undefined,
	harnessOf: HarnessOf,
): string | null {
	const command = last
		? harnessOf(last.harness)?.takeOverCommand(last.harnessSessionId)
		: null;
	if (!command) return null;
	return `cd ${shellQuote(worktreePath)} && ${command}`;
}

/**
 * A flow from a run's snapshot, in today's format: version 1 snapshots
 * migrate, and defaults apply. A snapshot that no longer parses is used as
 * it is, so an old run still shows.
 */
export function snapshotFlow(json: unknown): Flow {
	const migrated = migrateFlow(json);
	const parsed = flowSchema.safeParse(migrated);
	return parsed.success ? parsed.data : (migrated as Flow);
}

/** The flow the run started from, from the run's own snapshot. */
export function parseRunFlow(row: RunRow): Flow {
	return snapshotFlow(JSON.parse(row.flow));
}

/** The `body_flows` column holds every called flow (of Call nodes). */
export function parseCalledFlows(row: RunRow): Record<string, Flow> {
	const raw = JSON.parse(row.bodyFlows || "{}") as Record<string, unknown>;
	const flows: Record<string, Flow> = {};
	for (const [name, flow] of Object.entries(raw)) {
		flows[name] = snapshotFlow(flow);
	}
	return flows;
}

/** What a run summary reads from the log. The run log keeps it per run until the next append. */
export function runFacts(events: readonly LoggedEvent[]) {
	const state = deriveRunState(events);
	const open =
		state.status === "running" ||
		state.status === "waiting" ||
		state.status === "sleeping";
	return {
		status: state.status,
		reason: state.reason,
		wakeAt:
			state.status === "sleeping" ? (deriveSleep(events)?.until ?? null) : null,
		signal:
			state.status === "sleeping"
				? (deriveSleep(events)?.signal ?? null)
				: null,
		inputs: deriveInputs(events),
		stopAt: deriveStopAt(events),
		stopAfterStep: open && deriveStopAfterStep(events),
		...costFields(sumCost(events)),
		warnings: runWarnings(events),
		endedAt: deriveEndedAt(events),
		trigger: deriveTrigger(events),
		calls: deriveCalls(events),
		gates: deriveGateWaits(events),
	};
}

export type RunFacts = ReturnType<typeof runFacts>;

/** A cost tally as the summaries carry it. */
function costFields(cost: CostTally) {
	return {
		costUsd: cost.usd,
		costEstimated: cost.estimated,
		costMissing: cost.missing,
	};
}

/** The run's warnings, each with the node of its step. */
function runWarnings(events: readonly LoggedEvent[]): RunWarning[] {
	const warnings = deriveWarnings(events);
	if (warnings.length === 0) return [];
	const nodes = new Map(deriveSteps(events).map((s) => [s.id, s.nodeId]));
	return warnings.map((w) => ({
		kind: w.kind,
		message: w.message,
		stepId: w.stepId,
		nodeId: w.stepId ? (nodes.get(w.stepId) ?? null) : null,
		at: w.at,
	}));
}

/**
 * A run's summary. `names`: the names of the Persons it names (`namesOf`).
 * `walker`: the Device that walks it.
 */
export function toSummary(
	row: RunRow,
	facts: RunFacts,
	names: ReadonlyMap<string, string>,
	walker: RunWalker,
): RunSummary {
	const { calls, ...rest } = facts;
	return {
		id: row.id,
		projectId: row.projectId,
		walker,
		startedBy: runPerson(row.startedBy, names),
		flowName: row.flowName,
		title: row.title,
		worktreePath: row.worktreePath,
		branch: row.branch,
		baseRef: row.baseRef,
		...rest,
		subflows: subflowRuns(row, calls, facts.status),
		createdAt: row.createdAt.getTime(),
	};
}

/**
 * A Call step and its runs of the called flow, as the log has them. The
 * log names the flow of a Call once (`FlowCalled`), not the flow of a Call
 * with `each`: `subflowRuns` reads that from the run's flow snapshots.
 */
type CallFact = {
	stepId: string;
	nodeId: string;
	/** The Call step and item this step runs in. Null at the top level. */
	scope: Scope | null;
	/** Once: the flow it called. Null with `each`, or before it called. */
	flow: string | null;
	runs: {
		/** Null while the call or the item is open. */
		status: RunStatus | null;
		costUsd: number;
		costEstimated: boolean;
		costMissing: number;
		startedAt: number;
		endedAt: number | null;
	}[];
};

/** How a Call step (once) ended, as the status of the flow it ran. */
const callStatus: Partial<Record<StepOutcome, RunStatus>> = {
	fail: "failed",
	error: "failed",
	stopped: "stopped",
	interrupted: "interrupted",
};

/** The Call steps of a run, with what each run of a called flow spent and how it ended. */
function deriveCalls(events: readonly LoggedEvent[]): CallFact[] {
	const steps = deriveSteps(events);
	const byId = new Map(steps.map((step) => [step.id, step]));
	// The cost of each run of a called flow, with the flows it called, by scope key.
	const cost = new Map<string, CostTally>();
	for (const step of steps) {
		for (let scope = step.scope; scope; ) {
			const key = scopeKey(scope);
			cost.set(key, addCost(cost.get(key) ?? NO_COST, step.cost));
			scope = byId.get(scope.parentStepId)?.scope ?? null;
		}
	}
	const calls: CallFact[] = [];
	for (const step of steps) {
		if (step.nodeType !== "call") continue;
		const ended =
			step.outcome === null ? null : (callStatus[step.outcome] ?? "finished");
		const once = { parentStepId: step.id, itemId: null };
		// Items run one at a time: a stop or a daemon death cuts the last one.
		const last = step.items.findLast((item) => item.state !== "blocked");
		calls.push({
			stepId: step.id,
			nodeId: step.nodeId,
			scope: step.scope,
			flow: step.call?.flow ?? null,
			runs: step.call
				? [
						{
							status: ended,
							...costFields(cost.get(scopeKey(once)) ?? NO_COST),
							startedAt: step.startedAt,
							endedAt: step.endedAt,
						},
					]
				: step.items
						// A blocked item never ran its flow.
						.filter((item) => item.state !== "blocked")
						.map((item) => ({
							status:
								item.state === "running"
									? null
									: item.state !== "failed"
										? "finished"
										: item === last &&
												(ended === "stopped" || ended === "interrupted")
											? ended
											: "failed",
							...costFields(
								cost.get(scopeKey({ ...once, itemId: item.facts.id })) ??
									NO_COST,
							),
							startedAt: item.startedAt,
							endedAt: item.endedAt,
						})),
		});
	}
	return calls;
}

/**
 * The runs of called flows inside a run, by flow name. The flow of a Call
 * with `each` comes from the node in the flow that holds it: the run's flow
 * at the top level, else the flow its parent Call step ran.
 */
function subflowRuns(
	row: RunRow,
	calls: readonly CallFact[],
	runStatus: RunStatus,
): SubflowRun[] {
	if (calls.length === 0) return [];
	// Parsed only when a Call with `each` needs them.
	let parsed: { top: Flow; called: Record<string, Flow> } | null = null;
	const snapshots = () =>
		(parsed ??= { top: parseRunFlow(row), called: parseCalledFlows(row) });
	const calledFlow = (name: string | null): Flow | undefined => {
		const { called } = snapshots();
		return name !== null && Object.hasOwn(called, name)
			? called[name]
			: undefined;
	};
	const byStep = new Map(calls.map((call) => [call.stepId, call]));
	const names = new Map<string, string | null>();
	const nameOf = (call: CallFact): string | null => {
		if (call.flow !== null) return call.flow;
		const known = names.get(call.stepId);
		if (known !== undefined) return known;
		const parent = call.scope ? byStep.get(call.scope.parentStepId) : undefined;
		const holder = call.scope
			? parent && calledFlow(nameOf(parent))
			: snapshots().top;
		const node = holder?.nodes.find((n) => n.id === call.nodeId);
		const name = node?.type === "call" ? node.flow : null;
		names.set(call.stepId, name);
		return name;
	};
	return calls
		.flatMap((call) => {
			const flowName = nameOf(call);
			if (flowName === null) return [];
			return call.runs.map((run) => ({
				flowName,
				...run,
				status: run.status ?? runStatus,
			}));
		})
		.sort((a, b) => a.startedAt - b.startedAt);
}

export function toStepSummary(derived: DerivedStep): StepSummary {
	return {
		id: derived.id,
		nodeId: derived.nodeId,
		nodeType: derived.nodeType,
		visit: derived.visit,
		startedAt: derived.startedAt,
		endedAt: derived.endedAt,
		outcome: derived.outcome,
		outputs: derived.outputs,
		error: derived.error,
		scope: derived.scope,
		items: derived.items.map(
			(item): ItemSummary => ({
				id: item.facts.id,
				title: item.facts.title,
				url: item.facts.url,
				value: item.facts.value,
				state: item.state,
				branch: item.branch,
				baseBranch: item.baseBranch,
				startedAt: item.startedAt,
				endedAt: item.endedAt,
				reason: item.reason,
			}),
		),
		sessions: derived.sessions.map((s) => ({
			id: s.id,
			harnessSessionId: s.harnessSessionId,
			prompt: s.prompt,
			createdAt: s.startedAt,
			outcome: s.ending?.outcome ?? null,
			error: s.ending?.error ?? null,
			costUsd: s.ending?.costUsd ?? null,
			costEstimated: sessionCost(s.ending).estimated,
		})),
		...costFields(derived.cost),
		gate: derived.gate
			? {
					question: derived.gate.question,
					choices: derived.gate.choices,
					openedAt: derived.gate.openedAt,
				}
			: null,
	};
}

/** Everything the run page shows: the summary, the flows, the steps, the edges, the resumes. */
export function toRunDetail(
	row: RunRow,
	events: readonly LoggedEvent[],
	harnessOf: HarnessOf,
	names: ReadonlyMap<string, string>,
	walker: RunWalker,
	commands: PendingCommand[] = [],
): RunDetail {
	// A run walked elsewhere: its worktree is on its Walker, not here.
	const last = walker.thisDevice ? lastHarnessSession(events) : null;
	return {
		...toSummary(row, runFacts(events), names, walker),
		flow: parseRunFlow(row),
		calledFlows: parseCalledFlows(row),
		steps: deriveSteps(events).map(toStepSummary),
		// Edges of the top-level flow; body edges count per item.
		traversals: deriveTraversals(events),
		takeOverCommand: takeOverCommand(row.worktreePath, last, harnessOf),
		resumes: deriveResumes(events),
		commands,
	};
}

export type ReadModelDeps = {
	db: Database;
	log: RunLog;
	bus: RunBus;
	/** Whether the run holds a slot (the runner's `isActive`). */
	isActive(runId: string): boolean;
	/** The harness port of that name, for its take-over command. */
	harnessOf: HarnessOf;
	/** The Walkers of runs of a Space, by id. */
	walkers(
		spaceId: string,
		ids: readonly string[],
	): Promise<Map<string, RunWalker>>;
	/** The run's actions that wait for its Walker. */
	pendingCommands(runId: string): Promise<PendingCommand[]>;
	/**
	 * A step's transcript. A step of a run walked elsewhere comes from the
	 * archive; `ended` says whether it can change still.
	 */
	stepTranscript(
		row: { id: string; runId: string; spaceId: string; transcriptPath: string },
		walker: RunWalker,
		ended: boolean,
	): Promise<TranscriptEntry[]>;
};

/** A Walker the Replica knows nothing of: a name is all it lacks. */
const walkerOf = (walkers: Map<string, RunWalker>, id: string): RunWalker =>
	walkers.get(id) ?? { id, name: null, thisDevice: false };

export type ReadModel = ReturnType<typeof createReadModel>;

/** The reads that need the database, the run log or the bus. */
export function createReadModel(deps: ReadModelDeps) {
	const { db, log, bus, isActive, harnessOf } = deps;

	async function walkerOfRun(row: RunRow): Promise<RunWalker> {
		return walkerOf(
			await deps.walkers(row.spaceId, [row.walkerId]),
			row.walkerId,
		);
	}

	/** The Space's runs (of one project), newest first, with the facts the log gives each one. */
	async function listRuns(
		spaceId: string,
		projectId?: string,
	): Promise<RunSummary[]> {
		const rows = await db
			.select()
			.from(run)
			.where(
				and(
					eq(run.spaceId, spaceId),
					projectId ? eq(run.projectId, projectId) : undefined,
				),
			)
			.orderBy(desc(run.createdAt));
		const facts = await log.derive(
			rows.map((r) => r.id),
			runFacts,
		);
		const walkers = await deps.walkers(
			spaceId,
			rows.map((r) => r.walkerId),
		);
		const names = await namesOf(
			db,
			rows.map((r) => r.startedBy),
		);
		return rows.map((row) =>
			toSummary(
				row,
				facts.get(row.id) ?? runFacts([]),
				names,
				walkerOf(walkers, row.walkerId),
			),
		);
	}

	async function getRun(runId: string): Promise<RunDetail> {
		const row = await getRunRow(db, runId);
		const events = await log.events(runId);
		const walker = await walkerOfRun(row);
		return toRunDetail(
			row,
			events,
			harnessOf,
			await namesOf(db, [row.startedBy]),
			walker,
			walker.thisDevice ? [] : await deps.pendingCommands(runId),
		);
	}

	/** The run's status, or null for a run the log has nothing on. */
	async function runStatus(runId: string): Promise<RunStatus | null> {
		const events = await log.events(runId);
		return events.length === 0 ? null : deriveRunState(events).status;
	}

	/** The open Gates of the Space's runs of projects a person has not removed, oldest first. */
	async function listGates(spaceId: string): Promise<OpenGate[]> {
		const rows = await db
			.select({ run, projectName: project.name })
			.from(run)
			.innerJoin(project, eq(run.projectId, project.id))
			.where(and(eq(run.spaceId, spaceId), isNull(project.removedAt)));
		// Only a waiting run has an open Gate. The run list keeps the same facts.
		const facts = await log.derive(
			rows.map((r) => r.run.id),
			runFacts,
		);
		const open = await log.derive(
			rows
				.map((r) => r.run.id)
				.filter((id) => facts.get(id)?.status === "waiting"),
			deriveOpenGate,
		);
		const walkers = await deps.walkers(
			spaceId,
			rows.filter((r) => open.has(r.run.id)).map((r) => r.run.walkerId),
		);
		const gates: OpenGate[] = [];
		for (const { run: row, projectName } of rows) {
			const gate = open.get(row.id);
			if (!gate) continue;
			const walker = walkerOf(walkers, row.walkerId);
			const answerPending =
				!walker.thisDevice &&
				(await deps.pendingCommands(row.id)).some(
					(c) => c.kind === "gate.resolve",
				);
			gates.push({
				runId: row.id,
				runTitle: row.title,
				projectId: row.projectId,
				projectName,
				stepId: gate.stepId,
				nodeId: gate.nodeId,
				question: gate.question,
				choices: gate.choices,
				openedAt: gate.openedAt,
				walker,
				answerPending,
			});
		}
		return gates.sort((a, b) => a.openedAt - b.openedAt);
	}

	/**
	 * Resolves once `done` holds for the run's log, or the run's drive ended
	 * without it. Subscribes before the first look, so an append between the
	 * two is not missed.
	 */
	function untilLogged(
		runId: string,
		done: (events: readonly LoggedEvent[]) => boolean,
	): Promise<void> {
		return new Promise<void>((resolve) => {
			let settled = false;
			const unsubscribe = bus.subscribe(runId, () => void check());
			async function check(): Promise<void> {
				if (settled) return;
				const events = await log.events(runId);
				if (settled) return;
				if (done(events) || !isActive(runId)) {
					settled = true;
					unsubscribe();
					resolve();
				}
			}
			void check();
		});
	}

	/**
	 * The run's status, its steps and its transcript so far, then every
	 * change as it happens, until `signal` aborts. Transcript entries up to
	 * `afterSeq` are skipped.
	 */
	async function* watch(
		runId: string,
		signal: AbortSignal,
		afterSeq: number,
	): AsyncGenerator<RunStreamItem> {
		const runRow = await getRunRow(db, runId);
		const walker = await walkerOfRun(runRow);
		if (signal.aborted) return;

		const queue: (
			| { kind: "transcript"; entry: TranscriptEntry }
			| { kind: "status-changed" }
			| { kind: "step-changed"; stepId: string }
		)[] = [];
		let wakeWatcher: (() => void) | null = null;
		const notify = () => {
			const resolve = wakeWatcher;
			wakeWatcher = null;
			resolve?.();
		};
		// Subscribe before reading the log and the disk: an entry is on disk
		// before it is published, so every entry is either on disk or queued.
		const unsubscribe = bus.subscribe(runId, (item) => {
			queue.push(item);
			notify();
		});
		signal.addEventListener("abort", notify, { once: true });

		try {
			let lastSeq = afterSeq;
			const events = await log.events(runId);
			let lastStatus: RunStatus = deriveRunState(events).status;
			yield { kind: "status", status: lastStatus };

			const steps = deriveSteps(events);
			for (const derived of steps) {
				if (signal.aborted) return;
				yield { kind: "step", step: toStepSummary(derived) };
			}

			const rows = await db
				.select({
					id: step.id,
					runId: step.runId,
					spaceId: step.spaceId,
					transcriptPath: step.transcriptPath,
				})
				.from(step)
				.where(eq(step.runId, runId));
			const ended = new Set(
				steps.filter((s) => s.endedAt !== null).map((s) => s.id),
			);
			const replay = (
				await Promise.all(
					rows.map((row) =>
						deps.stepTranscript(row, walker, ended.has(row.id)),
					),
				)
			)
				.flat()
				.sort((a, b) => a.seq - b.seq);
			for (const entry of replay) {
				if (signal.aborted) return;
				if (entry.seq <= lastSeq) continue;
				lastSeq = entry.seq;
				yield { kind: "transcript", entry };
			}

			while (!signal.aborted) {
				const item = queue.shift();
				if (!item) {
					await new Promise<void>((resolve) => {
						wakeWatcher = resolve;
					});
					continue;
				}
				if (item.kind === "transcript") {
					if (item.entry.seq <= lastSeq) continue;
					lastSeq = item.entry.seq;
					yield item;
				} else if (item.kind === "step-changed") {
					const current = deriveSteps(await log.events(runId)).find(
						(s) => s.id === item.stepId,
					);
					if (current) yield { kind: "step", step: toStepSummary(current) };
					// A step walked elsewhere ended: its transcript is in the archive.
					if (current && !walker.thisDevice && current.endedAt !== null) {
						const [row] = rows.filter((r) => r.id === current.id);
						const entries = await deps.stepTranscript(
							row ?? {
								id: current.id,
								runId,
								spaceId: runRow.spaceId,
								transcriptPath: "",
							},
							walker,
							true,
						);
						for (const entry of entries) {
							if (signal.aborted) return;
							if (entry.seq <= lastSeq) continue;
							lastSeq = entry.seq;
							yield { kind: "transcript", entry };
						}
					}
				} else {
					const status = deriveRunState(await log.events(runId)).status;
					if (status !== lastStatus) {
						lastStatus = status;
						yield { kind: "status", status };
					}
				}
			}
		} finally {
			unsubscribe();
			signal.removeEventListener("abort", notify);
		}
	}

	return { listRuns, getRun, runStatus, listGates, untilLogged, watch };
}
