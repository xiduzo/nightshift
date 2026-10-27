import { shellQuote } from "@nightshift/agents/harness-facts";
import type { AgentHarness, AgentHarnessName } from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { project, run } from "@nightshift/db/schema";
import { type Flow, flowSchema, migrateFlow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import {
	type Derive,
	type LoggedEvent,
	type RunBus,
	type RunLog,
	type RunRow,
	type RunStatus,
	type Scope,
	type StepOutcome,
	scopeKey,
	type TranscriptEntry,
	type WaitReason,
} from "../log";
import { addCost, type CostTally, NO_COST, sessionCost } from "./cost";
import {
	deriveCalledTraversals,
	deriveEndedAt,
	deriveGateWaits,
	deriveInputs,
	deriveOpenGate,
	deriveResumes,
	deriveRunState,
	deriveSleep,
	deriveStopAfterStep,
	deriveStopAt,
	deriveTraversals,
	deriveTrigger,
	deriveWarnings,
	isOpenStatus,
} from "./derive-run";
import {
	type DerivedStep,
	deriveSteps,
	deriveVariableChanges,
	lastHarnessSession,
	sumCost,
} from "./derive-steps";
import { namesOf, runPerson } from "./people";
import { followRunTranscript, type StepEntries } from "./run-transcript";
import type {
	ItemSummary,
	OpenGate,
	PendingCommand,
	ProjectRuns,
	RunDetail,
	RunDevice,
	RunPage,
	RunStreamItem,
	RunSummary,
	RunWalker,
	RunWarning,
	StepDetail,
	StepSummary,
	SubflowRun,
} from "./views";

/**
 * The read model: what people see of a run, derived from the event log
 * (design rule: the log is the read model). This module only reads. The
 * pure half (`runFacts`, `toSummary`, `toStepSummary`, `toRunDetail`,
 * `takeOverCommand`, the flow snapshot parsers) turns rows and events into
 * the `views.ts` shapes; `createReadModel` adds the queries that need the
 * database, the run log and the bus (`listRuns`, `getRun`, `listGates`,
 * `runStatus`, `watch`).
 *
 * The seam is narrow on purpose: the engine passes `db`, `log`, `bus` and
 * the peers' reads and gets the reads back, so the shape of a summary changes in
 * one file (locality), and a test of a derivation needs no engine.
 *
 * Over 600 lines on purpose: that locality. Every view of a run that people
 * see is made here.
 */

/** What a step that is not in its run says. */
const STEP_NOT_FOUND = "Night Shift cannot find this step of the run.";

/** The take-over facts of the harness of that name, or none. */
export type HarnessOf = (
	name: AgentHarnessName,
) => Pick<AgentHarness, "takeOverCommand"> | undefined;

/**
 * The command a person runs in the worktree to take over the last harness
 * session, from the harness port's `takeOverCommand`. Null when there is
 * none, when the harness is not built, or when it has no command for it.
 */
export function takeOverCommand(
	worktreePath: string,
	last:
		| { harness: AgentHarnessName; harnessSessionId: string }
		| null
		| undefined,
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

/**
 * What a run summary reads from the log. The run log keeps it per run until
 * the next append. The steps are derived once, for every part that reads them.
 */
export function runFacts(events: readonly LoggedEvent[]) {
	const steps = deriveSteps(events);
	const state = deriveRunState(events, steps);
	const open = isOpenStatus(state.status);
	const sleep = state.status === "sleeping" ? deriveSleep(events, steps) : null;
	return {
		status: state.status,
		reason: state.reason,
		result: state.result,
		wakeAt: sleep?.until ?? null,
		signal: sleep?.signal ?? null,
		/** What the run sleeps for. Only `RunHere` carries it, not the summary. */
		waitReason: sleep?.reason ?? null,
		inputs: deriveInputs(events),
		stopAt: deriveStopAt(events),
		stopAfterStep: open && deriveStopAfterStep(events),
		...costFields(sumCost(events, steps)),
		warnings: runWarnings(events, steps),
		endedAt: deriveEndedAt(events),
		trigger: deriveTrigger(events),
		calls: deriveCalls(steps),
		gates: deriveGateWaits(events),
	};
}

export type RunFacts = ReturnType<typeof runFacts>;

/** The run's status, or null for a run the log has nothing on. */
function knownStatus(events: readonly LoggedEvent[]): RunStatus | null {
	return events.length === 0 ? null : deriveRunState(events).status;
}

/** A run's status and whether it is on this computer (`ReadModel.runHere`). */
export type RunHere = {
	id: string;
	status: RunStatus;
	wakeAt: number | null;
	/** What a sleeping run waits for: a time, the network, an offline Device. Null while it does not sleep. */
	waitReason: WaitReason | null;
	/** This computer walks it. */
	walkedHere: boolean;
	/** Its steps run on this computer (its Device, as its row says). */
	stepsHere: boolean;
};

/** A cost tally as the summaries carry it. */
function costFields(cost: CostTally) {
	return {
		costUsd: cost.usd,
		costEstimated: cost.estimated,
		costMissing: cost.missing,
		costCalls: cost.calls,
	};
}

/** The run's warnings, each with the node of its step. */
function runWarnings(
	events: readonly LoggedEvent[],
	steps: readonly DerivedStep[],
): RunWarning[] {
	const warnings = deriveWarnings(events);
	if (warnings.length === 0) return [];
	const nodes = new Map(steps.map((s) => [s.id, s.nodeId]));
	return warnings.map((w) => ({
		kind: w.kind,
		message: w.message,
		stepId: w.stepId,
		nodeId: w.stepId ? (nodes.get(w.stepId) ?? null) : null,
		at: w.at,
	}));
}

/** The Device a run's steps run on: its own, else (a run from before Placement) its Walker. */
export function runDeviceId(row: Pick<RunRow, "deviceId" | "walkerId">) {
	return row.deviceId ?? row.walkerId;
}

/**
 * A run's summary. `names`: the names of the Persons it names (`namesOf`).
 * `walker`: the Device that walks it; `device`: the one its steps run on
 * (default: the Walker).
 */
export function toSummary(
	row: RunRow,
	facts: RunFacts,
	names: ReadonlyMap<string, string>,
	walker: RunWalker,
	device: RunDevice = walker,
): RunSummary {
	const { calls, waitReason: _, ...rest } = facts;
	return {
		id: row.id,
		projectId: row.projectId,
		walker,
		device,
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
		costCalls: number;
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
function deriveCalls(steps: readonly DerivedStep[]): CallFact[] {
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

/** A Device this Replica knows nothing of: a name is all it lacks. */
const unnamed = (id: string): RunDevice => ({
	id,
	name: null,
	thisDevice: false,
});

/** Names a Device by id, as this Replica knows it. */
export type DeviceNamer = (id: string) => RunDevice;

/**
 * A step as the run and its stream show it: without the prompts and the
 * elements of its items (`toStepDetail`).
 */
export function toStepSummary(
	derived: DerivedStep,
	deviceOf?: DeviceNamer,
): StepSummary {
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
			createdAt: s.startedAt,
			outcome: s.ending?.outcome ?? null,
			error: s.ending?.error ?? null,
			costUsd: s.ending?.costUsd ?? s.spent?.costUsd ?? null,
			costEstimated: sessionCost(s).estimated,
		})),
		...costFields(derived.cost),
		device:
			derived.deviceId === null
				? null
				: (deviceOf?.(derived.deviceId) ?? {
						id: derived.deviceId,
						name: null,
						thisDevice: false,
					}),
		gate: derived.gate
			? {
					question: derived.gate.question,
					choices: derived.gate.choices,
					openedAt: derived.gate.openedAt,
					deadline: derived.gate.deadline,
				}
			: null,
	};
}

/** A step with the prompt of each session and the element of each item: what a person opens. */
export function toStepDetail(
	derived: DerivedStep,
	deviceOf?: DeviceNamer,
): StepDetail {
	const summary = toStepSummary(derived, deviceOf);
	return {
		...summary,
		sessions: summary.sessions.map((session, i) => ({
			...session,
			prompt: derived.sessions[i]?.prompt ?? "",
		})),
		items: summary.items.map((item, i) => ({
			...item,
			value: derived.items[i]?.facts.value ?? null,
		})),
	};
}

/**
 * Everything the run page shows: the summary, the flows, the steps, the
 * edges, the resumes. `facts` and `steps` are `runFacts` and `deriveSteps`
 * of `events`, as the run log keeps them (`RunLog.derive`).
 */
export function toRunDetail(
	row: RunRow,
	events: readonly LoggedEvent[],
	derived: { facts: RunFacts; steps: readonly DerivedStep[] },
	harnessOf: HarnessOf,
	names: ReadonlyMap<string, string>,
	walker: RunWalker,
	commands: PendingCommand[] = [],
	deviceOf?: DeviceNamer,
): RunDetail {
	const device = deviceOf?.(runDeviceId(row)) ?? walker;
	// A run walked or placed elsewhere: its worktree is not on this computer.
	const last =
		walker.thisDevice && device.thisDevice ? lastHarnessSession(events) : null;
	return {
		...toSummary(row, derived.facts, names, walker, device),
		flow: parseRunFlow(row),
		calledFlows: parseCalledFlows(row),
		steps: derived.steps.map((step) => toStepSummary(step, deviceOf)),
		// Edges of the top-level flow; a called flow's edges count per scope.
		traversals: deriveTraversals(events),
		calledTraversals: deriveCalledTraversals(events),
		takeOverCommand: takeOverCommand(row.worktreePath, last, harnessOf),
		resumes: deriveResumes(events),
		commands,
		variables: deriveVariableChanges(events),
		handOffs: events.flatMap((e) =>
			e.type === "HandedOff"
				? [
						{
							at: e.at,
							stepId: e.stepId,
							from: deviceOf?.(e.payload.from) ?? unnamed(e.payload.from),
							to: deviceOf?.(e.payload.to) ?? unnamed(e.payload.to),
							commit: e.payload.commit,
						},
					]
				: [],
		),
	};
}

export type ReadModelDeps = {
	db: Database;
	log: RunLog;
	bus: RunBus;
	/** This computer's Device id (and the run log's Walker id). */
	deviceId: string;
	/** The harness port of that name, for its take-over command. */
	harnessOf: HarnessOf;
	/** The Walkers of runs of a Space (and the Devices their steps run on), by id. */
	walkers(
		spaceId: string,
		ids: readonly string[],
	): Promise<Map<string, RunWalker>>;
	/** The actions of each run that wait for its Walker, by run id. */
	pendingCommands(
		runIds: readonly string[],
	): Promise<Map<string, PendingCommand[]>>;
	/** A step's transcript, wherever its run is walked (`RunsPort.stepEntries`). */
	stepEntries: StepEntries;
};

/** A Walker the Replica knows nothing of: a name is all it lacks. */
const walkerOf = (walkers: Map<string, RunWalker>, id: string): RunWalker =>
	walkers.get(id) ?? { id, name: null, thisDevice: false };

export type ReadModel = ReturnType<typeof createReadModel>;

/** The reads that need the database, the run log or the bus. */
export function createReadModel(deps: ReadModelDeps) {
	const { db, log, bus, harnessOf } = deps;

	/*
	 * Every read of a run's derived state goes through the run log's
	 * `derive`: the run list, each watcher of the run and the run page
	 * share one derivation per append.
	 */
	async function one<T>(runId: string, fn: Derive<T>): Promise<T> {
		return (await log.derive([runId], fn)).get(runId) as T;
	}

	/** Names the Devices a Space's runs name: their Walkers and Placements. */
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

	/**
	 * The Space's runs (of one project), newest first, with the facts the
	 * log gives each one. With `page`, at most `limit` of them with one of
	 * its `statuses`, after its `cursor`.
	 */
	async function listRuns(
		spaceId: string,
		projectId?: string,
		page: RunPage = {},
	): Promise<RunSummary[]> {
		const { cursor, statuses } = page;
		// A status is the log's, not a column's: those pages are cut after the facts.
		const limit = statuses ? undefined : page.limit;
		const query = db
			.select()
			.from(run)
			.where(
				and(
					eq(run.spaceId, spaceId),
					projectId ? eq(run.projectId, projectId) : undefined,
					cursor
						? or(
								lt(run.createdAt, new Date(cursor.createdAt)),
								and(
									eq(run.createdAt, new Date(cursor.createdAt)),
									lt(run.id, cursor.id),
								),
							)
						: undefined,
				),
			)
			.orderBy(desc(run.createdAt), desc(run.id));
		const read = await (limit === undefined ? query : query.limit(limit));
		const facts = await log.derive(
			read.map((r) => r.id),
			runFacts,
		);
		const rows = statuses
			? read
					.filter((r) => {
						const status = facts.get(r.id)?.status;
						return status !== undefined && statuses.includes(status);
					})
					.slice(0, page.limit)
			: read;
		const deviceOf = await namer(
			spaceId,
			rows.flatMap((r) => [r.walkerId, runDeviceId(r)]),
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
				deviceOf(row.walkerId),
				deviceOf(runDeviceId(row)),
			),
		);
	}

	/** The run page of `row`, the run's row (the caller has read it). */
	/**
	 * How the runs of each project of the Space stand, by project id. A
	 * project without runs is not in it. The facts are the run list's.
	 */
	async function projectRuns(
		spaceId: string,
	): Promise<Map<string, ProjectRuns>> {
		const rows = await db
			.select({
				id: run.id,
				projectId: run.projectId,
				title: run.title,
				createdAt: run.createdAt,
			})
			.from(run)
			.where(eq(run.spaceId, spaceId))
			.orderBy(desc(run.createdAt), desc(run.id));
		const facts = await log.derive(
			rows.map((r) => r.id),
			runFacts,
		);
		const counts = new Map<string, ProjectRuns>();
		for (const row of rows) {
			let counted = counts.get(row.projectId);
			if (!counted) {
				// Newest first: the first row of a project is its last run.
				counted = {
					total: 0,
					statuses: {},
					last: {
						id: row.id,
						title: row.title,
						createdAt: row.createdAt.getTime(),
					},
					nextWakeAt: null,
				};
				counts.set(row.projectId, counted);
			}
			const fact = facts.get(row.id);
			if (!fact) continue;
			counted.total += 1;
			counted.statuses[fact.status] = (counted.statuses[fact.status] ?? 0) + 1;
			if (
				fact.wakeAt !== null &&
				(counted.nextWakeAt === null || fact.wakeAt < counted.nextWakeAt)
			) {
				counted.nextWakeAt = fact.wakeAt;
			}
		}
		return counts;
	}

	async function getRun(row: RunRow): Promise<RunDetail> {
		const runId = row.id;
		const events = await log.events(runId);
		const steps = await one(runId, deriveSteps);
		const facts = await one(runId, runFacts);
		const deviceOf = await namer(row.spaceId, [
			row.walkerId,
			runDeviceId(row),
			...steps.map((s) => s.deviceId),
			...events.flatMap((e) =>
				e.type === "HandedOff" ? [e.payload.from, e.payload.to] : [],
			),
		]);
		const walker = deviceOf(row.walkerId);
		return toRunDetail(
			row,
			events,
			{ facts, steps },
			harnessOf,
			await namesOf(db, [row.startedBy]),
			walker,
			walker.thisDevice
				? []
				: ((await deps.pendingCommands([runId])).get(runId) ?? []),
			deviceOf,
		);
	}

	/** One step of the run with its prompts and the elements of its items, or "not found". */
	async function getStep(row: RunRow, stepId: string): Promise<StepDetail> {
		const steps = await one(row.id, deriveSteps);
		const step = steps.find((s) => s.id === stepId);
		if (!step) throw new Refusal("not-found", STEP_NOT_FOUND);
		return toStepDetail(step, await namer(row.spaceId, [step.deviceId]));
	}

	/** The run's status, or null for a run the log has nothing on. */
	async function runStatus(runId: string): Promise<RunStatus | null> {
		return one(runId, knownStatus);
	}

	/**
	 * Where a run is and what it does, cheap: its status, when it wakes,
	 * and whether this computer walks it or runs its steps. Null when this
	 * Replica has no such run. One row and the run log's kept facts.
	 */
	async function runHere(runId: string): Promise<RunHere | null> {
		const [row] = await db
			.select({ walkerId: run.walkerId, deviceId: run.deviceId })
			.from(run)
			.where(eq(run.id, runId));
		if (!row) return null;
		const facts = await one(runId, runFacts);
		const self = await log.walkerId();
		const here = (id: string) => id === self || id === deps.deviceId;
		return {
			id: runId,
			status: facts.status,
			wakeAt: facts.wakeAt,
			waitReason: facts.waitReason,
			walkedHere: here(row.walkerId),
			stepsHere: here(runDeviceId(row)),
		};
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
		const withGate = rows.filter((r) => open.has(r.run.id));
		const walkers = await deps.walkers(
			spaceId,
			withGate.map((r) => r.run.walkerId),
		);
		// One read for the answers that wait for a Walker elsewhere.
		const pending = await deps.pendingCommands(
			withGate
				.filter((r) => !walkerOf(walkers, r.run.walkerId).thisDevice)
				.map((r) => r.run.id),
		);
		const gates: OpenGate[] = [];
		for (const { run: row, projectName } of rows) {
			const gate = open.get(row.id);
			if (!gate) continue;
			const walker = walkerOf(walkers, row.walkerId);
			const answerPending = (pending.get(row.id) ?? []).some(
				(c) => c.kind === "gate.resolve",
			);
			gates.push({
				spaceId: row.spaceId,
				runId: row.id,
				runTitle: row.title,
				flowName: row.flowName,
				projectId: row.projectId,
				projectName,
				stepId: gate.stepId,
				nodeId: gate.nodeId,
				question: gate.question,
				choices: gate.choices,
				lockScreen: gate.lockScreen,
				openedAt: gate.openedAt,
				deadline: gate.deadline,
				walker,
				answerPending,
			});
		}
		return gates.sort((a, b) => a.openedAt - b.openedAt);
	}

	/**
	 * The run's status, its steps and its transcript so far, then every
	 * change as it happens, until `signal` aborts. Transcript entries up to
	 * `afterSeq` are skipped. The transcript goes out in `seq` order
	 * (`followRunTranscript`), wherever the run is walked. When it cannot
	 * be read, the watch ends with that error: the viewer reads again from
	 * its cursor.
	 */
	async function* watch(
		runRow: RunRow,
		signal: AbortSignal,
		afterSeq: number,
	): AsyncGenerator<RunStreamItem> {
		const runId = runRow.id;
		if (signal.aborted) return;

		const queue: (
			| { kind: "transcript"; entry: TranscriptEntry }
			| { kind: "status-changed" }
			| { kind: "step-changed"; stepId: string }
			| { kind: "error"; error: unknown }
		)[] = [];
		let wakeWatcher: (() => void) | null = null;
		const notify = () => {
			const resolve = wakeWatcher;
			wakeWatcher = null;
			resolve?.();
		};
		// Subscribe before reading the log: no change of a step is missed.
		// The transcript has its own reader.
		const unsubscribe = bus.subscribe(runId, (item) => {
			if (item.kind === "transcript") return;
			queue.push(item);
			notify();
		});
		const transcript = new AbortController();
		const stopTranscript = () => {
			transcript.abort();
			notify();
		};
		signal.addEventListener("abort", stopTranscript, { once: true });

		try {
			// Keeps the run's log in memory while it is open (`logOf`): each
			// change then derives from it, not from a read of every event.
			await log.events(runId);
			let lastStatus: RunStatus = (await one(runId, runFacts)).status;
			yield { kind: "status", status: lastStatus };

			// A copy: the steps the run log keeps are shared.
			const steps = [...(await one(runId, deriveSteps))];
			let deviceOf = await namer(runRow.spaceId, [
				runRow.walkerId,
				...steps.map((s) => s.deviceId),
			]);
			for (const derived of steps) {
				if (signal.aborted) return;
				yield { kind: "step", step: toStepSummary(derived, deviceOf) };
			}

			void (async () => {
				try {
					for await (const entry of followRunTranscript(
						{ log, bus, stepEntries: deps.stepEntries },
						runRow,
						afterSeq,
						transcript.signal,
					)) {
						queue.push({ kind: "transcript", entry });
						notify();
					}
				} catch (error) {
					if (transcript.signal.aborted) return;
					queue.push({ kind: "error", error });
					notify();
				}
			})();

			while (!signal.aborted) {
				const item = queue.shift();
				if (!item) {
					await new Promise<void>((resolve) => {
						wakeWatcher = resolve;
					});
					continue;
				}
				if (item.kind === "transcript") {
					yield item;
				} else if (item.kind === "error") {
					throw item.error;
				} else if (item.kind === "step-changed") {
					const current = (await one(runId, deriveSteps)).find(
						(s) => s.id === item.stepId,
					);
					if (current) {
						if (
							current.deviceId !== null &&
							!steps.some((s) => s.deviceId === current.deviceId)
						) {
							steps.push(current);
							deviceOf = await namer(runRow.spaceId, [
								runRow.walkerId,
								...steps.map((s) => s.deviceId),
							]);
						}
						yield { kind: "step", step: toStepSummary(current, deviceOf) };
					}
				} else {
					const status = (await one(runId, runFacts)).status;
					if (status !== lastStatus) {
						lastStatus = status;
						yield { kind: "status", status };
					}
				}
			}
		} finally {
			unsubscribe();
			transcript.abort();
			signal.removeEventListener("abort", stopTranscript);
		}
	}

	return {
		listRuns,
		projectRuns,
		getRun,
		getStep,
		runStatus,
		runHere,
		listGates,
		watch,
	};
}
