import { randomUUID } from "node:crypto";
import type {
	AgentErrorKind,
	AgentEvent,
	AgentHarness,
	Decider,
	DecisionInput,
	DecisionResult,
	HarnessName,
	StepReportOutcome,
} from "@nightshift/agents/types";
import {
	agentSession,
	event,
	project,
	run,
	step,
} from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	blockersFirst,
	type CommandNode,
	type DecisionNode,
	type Flow,
	type FlowIssue,
	type FlowNode,
	type ForEachNode,
	type GateNode,
	type ItemField,
	newlyBlocked,
	nextEdge,
	nextItem,
	type Outcome,
	type Policy,
	parseFlow,
	policySchema,
	renderCommand,
	renderTemplate,
	type SourceItem,
	type TemplateContext,
	validateFlow,
} from "@nightshift/flows";
import {
	deleteFlowFile,
	listFlowFiles,
	loadAllFlows,
	readFlowFile,
	writeFlowFile,
} from "@nightshift/flows/files";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { createRunBus } from "./bus";
import { runCommand } from "./command";
import { consumeStream } from "./consume";
import {
	appendEvent,
	countStepsSinceWalkBegan,
	countVisits,
	type DerivedStep,
	deriveNodeOutputs,
	deriveOpenGate,
	deriveParams,
	deriveResumePoint,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	deriveStopAfterStep,
	deriveStopAt,
	deriveTraversals,
	type EngineEventType,
	type EnginePayloads,
	groupByRun,
	type ItemFacts,
	itemStates,
	type LoggedEvent,
	lastHarnessSession,
	lastHarnessSessionOfNode,
	openWork,
	parkedSteps,
	parseEventRow,
	type ResumePoint,
	type RunEnding,
	type Scope,
	type StepOutputs,
	scopeKey,
	sumCostUsd,
	type WaitReason,
	waitStreak,
} from "./events";
import {
	forEachOutputs,
	itemLabel,
	itemTemplateFields,
	parseCommandItems,
	toItemFacts,
} from "./foreach";
import { planWait } from "./policy";
import {
	commandLogPath,
	openTranscriptWriter,
	readRunTranscript,
	transcriptPath,
} from "./transcripts";
import type {
	Engine,
	EngineOptions,
	ItemSummary,
	OpenGate,
	Project,
	RunDetail,
	RunStatus,
	RunStreamItem,
	RunSummary,
	StartRunInput,
	StepEvent,
	StepOutcome,
	StepSummary,
	TranscriptEntry,
} from "./types";
import {
	createAndCheckoutBranch,
	createWorktree,
	currentBranch,
	freeBranchName,
	itemBranchName,
	resolveRepoTopLevel,
} from "./worktrees";

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const DEFAULT_MAX_STEPS_PER_RUN = 500;
/** How long a stopped harness may take to end its stream. */
const STOP_GRACE_MS = 5_000;
const DEFAULT_RESUME_PROMPT = "Continue where you left off.";
const TITLE_MAX_CHARS = 80;
const QUICK_RUN_TITLE = "Quick run";
const STOP_TIME_REASON = "Reached the stop time";
const STOP_AFTER_STEP_REASON = "Stopped after the running step, as asked.";
/** setTimeout cannot wait longer; a longer wait checks the clock and waits again. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The CLI a person runs to take over a harness session. */
const takeOverCli: Record<HarnessName, string> = {
	"claude-code": "claude",
};

type RunRow = typeof run.$inferSelect;
type SessionEnding = EnginePayloads["SessionEnded"];

/** Why a step's signal aborted. */
type AbortReason = "stopped" | "timeout" | "idle";

type ActiveWalk = {
	/** Aborts when a person stops the run. */
	controller: AbortController;
	done: Promise<void>;
};

/** A slot is reserved before any await, so two calls cannot both pass the cap. */
type Slot = ActiveWalk | "starting";

/** Where a walk (of the run, or of a For Each body for one item) begins. */
type WalkStart =
	| { kind: "node"; nodeId: string }
	/** A person resumed: the ended Agent step runs again in its harness session. */
	| {
			kind: "session";
			stepId: string;
			nodeId: string;
			harnessSessionId: string;
			prompt: string;
	  }
	/** A wait ended: the step that waited (still open) continues. */
	| { kind: "continue"; stepId: string; nodeId: string; prompt: string | null }
	/** The node already ended with this outcome (a person answered its Gate): take its edge. */
	| { kind: "outcome"; nodeId: string; outcome: Outcome }
	/**
	 * Continue a For Each step: the item `itemId` at `inner` (the body's
	 * start when null), or without an item, its loop with the next item.
	 */
	| {
			kind: "foreach";
			nodeId: string;
			stepId: string;
			itemId: string | null;
			inner: WalkStart | null;
	  };

/** How a step ended: exactly what `StepEnded` records. */
type StepResult = EnginePayloads["StepEnded"];

/**
 * How the walk of one scope ended. `finished` and `failed` are the scope's
 * own ends (an item's body result, or the run's at the top level). The
 * others unwind every scope up to the run.
 */
type ScopeEnd =
	| { kind: "finished"; node: FlowNode; outcome: Outcome }
	| { kind: "failed"; reason: string }
	/** A Gate opened or a step sleeps: the walk returns and frees its slot. */
	| { kind: "paused" }
	| { kind: "stopped"; reason: string | null }
	/** The run fails as a whole (the step cap), wherever the walk is. */
	| { kind: "aborted"; reason: string };

type UnwindEnd = Extract<ScopeEnd, { kind: "paused" | "stopped" | "aborted" }>;
type Unwind = { kind: "unwind"; end: UnwindEnd };

/** An Agent or Decision step that hit a usage limit or lost the network. */
type WaitRequest = {
	kind: "wait";
	reason: WaitReason;
	message: string;
	resetAt: number | null;
	costUsd?: number | null;
};

type RunContext = {
	row: RunRow;
	flow: Flow;
	bodyFlows: Record<string, Flow>;
	policy: Policy;
	walk: ActiveWalk;
};

/** One level of the walk: the top-level flow, or a For Each body for one item. */
type Frame = {
	flow: Flow;
	scope: Scope | null;
	key: string;
	/** `{{run.branch}}`: the run's branch, or the item's. */
	branch: string;
	item: Partial<Record<ItemField, string | number>> | null;
};

/** Knobs for tests only. Not part of the engine contract. */
export type EngineInternals = {
	/** How long one minute of a node's `timeoutMinutes`, `idleMinutes` or a policy wait lasts. Default 60 000 ms. */
	minuteMs?: number;
	/** The clock for waits and the stop time. Default `Date.now`. */
	now?: () => number;
	/** Aborting it clears the engine's wake timers: a test's way to let a daemon die. */
	signal?: AbortSignal;
};

/** Event types that open or close work. Recovery and the Gate inbox read only these. */
const LIFECYCLE_EVENT_TYPES = [
	"RunStarted",
	"RunResumed",
	"RunEnded",
	"StepStarted",
	"StepReopened",
	"StepEnded",
	"SessionStarted",
	"SessionEnded",
	"GateOpened",
	"WaitStarted",
	"WaitEnded",
] as const satisfies readonly EngineEventType[];

const isWaitKind = (
	kind: AgentErrorKind | null | undefined,
): kind is WaitReason => kind === "usage-limit" || kind === "network";

/**
 * The run's param values: the given value, else the default. Refuses names
 * the flow does not declare and required params without a value.
 */
export function resolveParams(
	flow: Flow,
	given: Record<string, string> | undefined,
): Record<string, string> {
	const declared = flow.params ?? [];
	const names = new Set(declared.map((param) => param.name));
	const unknown = Object.keys(given ?? {}).filter((name) => !names.has(name));
	if (unknown.length > 0) {
		throw new Error(
			`The flow has no param ${unknown.map((n) => `"${n}"`).join(", ")}.`,
		);
	}
	const values: Record<string, string> = {};
	const missing: string[] = [];
	for (const param of declared) {
		const value = given?.[param.name]?.trim() || param.default || "";
		if (value === "" && param.required) missing.push(param.label ?? param.name);
		values[param.name] = value;
	}
	if (missing.length > 0) {
		throw new Error(`The run needs a value for: ${missing.join(", ")}.`);
	}
	return values;
}

export function createEngine(
	options: EngineOptions,
	internals: EngineInternals = {},
): Engine {
	const minuteMs = internals.minuteMs ?? 60_000;
	const now = internals.now ?? Date.now;
	const { db, harnesses, dataDir, decider, readGithubItems } = options;
	const maxConcurrentRuns =
		options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
	if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1) {
		throw new Error("maxConcurrentRuns must be a positive integer.");
	}
	const maxStepsPerRun = options.maxStepsPerRun ?? DEFAULT_MAX_STEPS_PER_RUN;
	if (!Number.isInteger(maxStepsPerRun) || maxStepsPerRun < 1) {
		throw new Error("maxStepsPerRun must be a positive integer.");
	}

	const bus = createRunBus();
	/** Keyed by run id: the runs that walk in this process. */
	const slots = new Map<string, Slot>();
	/** The last transcript seq written per run. Loaded from disk on first use. */
	const lastSeqs = new Map<string, number>();
	/** Per-run queues: answering, stopping, waking and closing never interleave. */
	const runLocks = new Map<string, Promise<void>>();
	/** Timers that end the waits of sleeping runs, by run id. */
	const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Sleeping runs whose wait ended while the run cap was full. */
	const pendingWakes = new Set<string>();
	let disposed = false;
	internals.signal?.addEventListener(
		"abort",
		() => {
			disposed = true;
			for (const timer of wakeTimers.values()) clearTimeout(timer);
			wakeTimers.clear();
			pendingWakes.clear();
		},
		{ once: true },
	);

	const ready = recoverInterruptedWork();
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});

	/**
	 * A daemon that died left sessions, steps and runs open. They become
	 * `interrupted`. Nothing continues on its own: a person resumes. Open
	 * Gates and sleeping steps are facts, not lost work: a sleeping run gets
	 * its timer back (a wake time in the past fires at once).
	 */
	async function recoverInterruptedWork(): Promise<void> {
		const rows = await db
			.select()
			.from(event)
			.where(
				and(
					isNotNull(event.runId),
					inArray(event.type, [...LIFECYCLE_EVENT_TYPES]),
				),
			)
			.orderBy(asc(event.seq));
		const byRun = groupByRun(rows.map(parseEventRow));
		const error = "The daemon stopped while this ran.";
		for (const [runId, events] of byRun) {
			const open = openWork(events);
			for (const session of open.sessions) {
				await appendEvent(db, {
					type: "SessionEnded",
					runId,
					stepId: session.stepId,
					sessionId: session.id,
					payload: {
						outcome: "interrupted",
						error,
						errorKind: null,
						usage: null,
						costUsd: null,
						resetAt: null,
					},
				});
			}
			for (const open_ of open.steps) {
				await appendEvent(db, {
					type: "StepEnded",
					runId,
					stepId: open_.id,
					payload: {
						outcome: "interrupted",
						outputs: { ...open_.outputs, outcome: "interrupted" },
						error,
					},
				});
			}
			if (open.runOpen) {
				await appendEvent(db, {
					type: "RunEnded",
					runId,
					payload: {
						status: "interrupted",
						reason: "The daemon stopped while this run ran.",
					},
				});
			}
			const sleep = deriveSleep(events);
			if (sleep && !open.runOpen) scheduleWake(runId, sleep.until);
		}
	}

	/** Runs `fn` after every earlier `exclusive` call for the same run has settled. */
	function exclusive<T>(runId: string, fn: () => Promise<T>): Promise<T> {
		const previous = runLocks.get(runId) ?? Promise.resolve();
		const current = previous.then(fn);
		const tail = current.then(
			() => {},
			() => {},
		);
		runLocks.set(runId, tail);
		void tail.then(() => {
			if (runLocks.get(runId) === tail) runLocks.delete(runId);
		});
		return current;
	}

	function reserveSlot(runId: string): void {
		if (slots.has(runId)) {
			throw new Error(
				"This run is still running. Stop it or wait for it to end.",
			);
		}
		if (slots.size >= maxConcurrentRuns) {
			throw new Error(
				`The run cap is reached: ${slots.size} of ${maxConcurrentRuns} runs are running. Stop a run or wait for one to end.`,
			);
		}
		slots.set(runId, "starting");
	}

	function releaseStartingSlot(runId: string): void {
		if (slots.get(runId) === "starting") slots.delete(runId);
	}

	async function getRunRow(runId: string): Promise<RunRow> {
		const [row] = await db.select().from(run).where(eq(run.id, runId));
		if (!row) throw new Error(`Run not found: ${runId}`);
		return row;
	}

	/** A project that a person has not removed. */
	async function getProjectRow(projectId: string) {
		const [row] = await db
			.select()
			.from(project)
			.where(and(eq(project.id, projectId), isNull(project.removedAt)));
		if (!row) throw new Error(`Project not found: ${projectId}`);
		return row;
	}

	async function loadRunEvents(runId: string): Promise<LoggedEvent[]> {
		const rows = await db
			.select()
			.from(event)
			.where(eq(event.runId, runId))
			.orderBy(asc(event.seq));
		return rows.map(parseEventRow);
	}

	async function loadEventsByRun(
		runIds: readonly string[],
		types?: readonly EngineEventType[],
	): Promise<Map<string, LoggedEvent[]>> {
		if (runIds.length === 0) return new Map();
		const byRun = inArray(event.runId, [...runIds]);
		const rows = await db
			.select()
			.from(event)
			.where(types ? and(byRun, inArray(event.type, [...types])) : byRun)
			.orderBy(asc(event.seq));
		return groupByRun(rows.map(parseEventRow));
	}

	function parseRunFlow(row: RunRow): Flow {
		return JSON.parse(row.flow) as Flow;
	}

	function parseBodyFlows(row: RunRow): Record<string, Flow> {
		return JSON.parse(row.bodyFlows || "{}") as Record<string, Flow>;
	}

	function toSummary(row: RunRow, events: readonly LoggedEvent[]): RunSummary {
		const state = deriveRunState(events);
		const open =
			state.status === "running" ||
			state.status === "waiting" ||
			state.status === "sleeping";
		return {
			id: row.id,
			projectId: row.projectId,
			flowName: row.flowName,
			title: row.title,
			worktreePath: row.worktreePath,
			branch: row.branch,
			baseRef: row.baseRef,
			status: state.status,
			reason: state.reason,
			wakeAt:
				state.status === "sleeping"
					? (deriveSleep(events)?.until ?? null)
					: null,
			params: deriveParams(events),
			stopAt: deriveStopAt(events),
			stopAfterStep: open && deriveStopAfterStep(events),
			createdAt: row.createdAt.getTime(),
			costUsd: sumCostUsd(events),
		};
	}

	function toStepSummary(derived: DerivedStep): StepSummary {
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
					number: item.facts.number,
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
				prompt: s.prompt,
				createdAt: s.startedAt,
				outcome: s.ending?.outcome ?? null,
				error: s.ending?.error ?? null,
				costUsd: s.ending?.costUsd ?? null,
			})),
			costUsd: derived.costUsd,
		};
	}

	async function lastSeqOf(runId: string): Promise<number> {
		const known = lastSeqs.get(runId);
		if (known !== undefined) return known;
		const rows = await db
			.select({ transcriptPath: step.transcriptPath })
			.from(step)
			.where(eq(step.runId, runId));
		const entries = await readRunTranscript(rows.map((r) => r.transcriptPath));
		const last = entries.at(-1)?.seq ?? 0;
		// A step of this run may have written meanwhile; keep the larger.
		const current = Math.max(last, lastSeqs.get(runId) ?? 0);
		lastSeqs.set(runId, current);
		return current;
	}

	function topFrame(ctx: { row: RunRow; flow: Flow }): Frame {
		return {
			flow: ctx.flow,
			scope: null,
			key: "",
			branch: ctx.row.branch,
			item: null,
		};
	}

	/** Templates inside a frame read its own nodes, its item and the run. */
	function frameContext(
		row: RunRow,
		frame: Frame,
		events: readonly LoggedEvent[],
	): TemplateContext {
		const context: TemplateContext = {
			nodes: deriveNodeOutputs(events, frame.key),
			run: {
				branch: frame.branch,
				worktree: row.worktreePath,
				base_ref: row.baseRef,
				flow: row.flowName ?? row.title,
			},
			params: deriveParams(events),
		};
		if (frame.item) context.item = frame.item;
		return context;
	}

	async function endRun(
		runId: string,
		status: RunEnding,
		reason: string | null,
	): Promise<void> {
		try {
			await appendEvent(db, {
				type: "RunEnded",
				runId,
				payload: { status, reason },
			});
		} catch (error) {
			// The next start marks the run interrupted.
			console.error(`[engine] could not record the end of run ${runId}`, error);
		}
	}

	/**
	 * Takes over a reserved slot and walks the flow in the background. The
	 * slot is released when the walk ends, however it ends.
	 */
	function launchWalk(row: RunRow, start: WalkStart): void {
		const walk: ActiveWalk = {
			controller: new AbortController(),
			done: Promise.resolve(),
		};
		const flow = parseRunFlow(row);
		const ctx: RunContext = {
			row,
			flow,
			bodyFlows: parseBodyFlows(row),
			policy: policySchema.parse(flow.policy ?? {}),
			walk,
		};
		slots.set(row.id, walk);
		bus.publish(row.id, { kind: "status-changed" });
		walk.done = walkFlow(ctx, start).finally(() => {
			if (slots.get(row.id) === walk) slots.delete(row.id);
			bus.publish(row.id, { kind: "status-changed" });
			drainPendingWakes();
		});
	}

	/**
	 * The walk of the run: the top-level flow, with For Each bodies walked
	 * inside their steps. Every step is closed in the log before the next
	 * edge is chosen, and every choice reads the log again, so the log alone
	 * is enough to continue after a stop, a wait or a crash.
	 */
	async function walkFlow(ctx: RunContext, start: WalkStart): Promise<void> {
		const runId = ctx.row.id;
		try {
			const end = await walkScope(ctx, topFrame(ctx), start);
			switch (end.kind) {
				case "finished": {
					const { node, outcome } = end;
					const chosen =
						(outcome === "pass" && node.type !== "foreach") ||
						(outcome === "done" && node.type === "foreach");
					await endRun(
						runId,
						"finished",
						chosen ? null : `Ended at node "${node.id}" with "${outcome}".`,
					);
					return;
				}
				case "failed":
				case "aborted":
					await endRun(runId, "failed", end.reason);
					return;
				case "stopped":
					await endRun(runId, "stopped", end.reason);
					return;
				case "paused":
					// The walk pauses and frees its slot. A stop that came in while
					// the Gate opened or the wait began closes it at once.
					if (ctx.walk.controller.signal.aborted) await closeParked(runId);
					return;
			}
		} catch (error) {
			console.error(`[engine] the walk of run ${runId} failed`, error);
			await endRun(runId, "failed", `The engine failed: ${messageOf(error)}`);
		}
	}

	/** Why the walk must stop before a new step or item, or null. */
	function stopBeforeNext(events: readonly LoggedEvent[]): string | null {
		if (deriveStopAfterStep(events)) return STOP_AFTER_STEP_REASON;
		const stopAt = deriveStopAt(events);
		if (stopAt !== null && now() >= stopAt) return STOP_TIME_REASON;
		return null;
	}

	/** Walks one flow (the run's, or a body for one item) until it ends or unwinds. */
	async function walkScope(
		ctx: RunContext,
		frame: Frame,
		start: WalkStart,
	): Promise<ScopeEnd> {
		const runId = ctx.row.id;
		const signal = ctx.walk.controller.signal;
		let next: WalkStart = start;
		while (true) {
			if (signal.aborted) return { kind: "stopped", reason: null };
			const events = await loadRunEvents(runId);
			if (next.kind === "node") {
				const stop = stopBeforeNext(events);
				if (stop) return { kind: "stopped", reason: stop };
				const limit = ctx.policy.maxSteps ?? maxStepsPerRun;
				if (countStepsSinceWalkBegan(events) >= limit) {
					return {
						kind: "aborted",
						reason: `The run reached the limit of ${limit} steps before node "${next.nodeId}". Resume it to continue.`,
					};
				}
			}
			const nodeId = next.nodeId;
			const node = frame.flow.nodes.find((n) => n.id === nodeId);
			if (!node) {
				return { kind: "failed", reason: `The flow has no node "${nodeId}".` };
			}

			let outcome: Outcome;
			if (next.kind === "outcome") {
				outcome = next.outcome;
			} else {
				const result = await runStep(ctx, frame, node, next, events);
				if ("kind" in result) return result.end;
				if (result.outcome === "stopped") {
					return { kind: "stopped", reason: null };
				}
				if (result.outcome === "error" || result.outcome === "interrupted") {
					return {
						kind: "failed",
						reason: `Node "${node.id}" failed: ${result.error ?? "unknown error"}`,
					};
				}
				outcome = result.outcome;
			}

			const traversals = deriveTraversals(
				await loadRunEvents(runId),
				frame.key,
			);
			const choice = nextEdge({
				flow: frame.flow,
				from: node.id,
				outcome,
				traversals,
			});
			if (choice.kind === "end") {
				// `fail` and `needs-input` without an edge fail the walk. `pass`, a
				// Decision label, a Gate choice or a For Each outcome without an
				// edge is a chosen end.
				if (
					outcome === "pass" ||
					node.type === "decision" ||
					node.type === "gate" ||
					node.type === "foreach"
				) {
					return { kind: "finished", node, outcome };
				}
				return {
					kind: "failed",
					reason: `Node "${node.id}" ended with "${outcome}" and no edge leaves it on that outcome.`,
				};
			}
			if (choice.kind === "exhausted") {
				const edges = choice.edges
					.map(
						(e) =>
							`"${e.id}" (${e.from} → ${e.to} on ${e.outcome}, max ${e.max ?? "∞"})`,
					)
					.join(", ");
				return {
					kind: "failed",
					reason: `Node "${node.id}" ended with "${outcome}", but edge ${edges} reached its max.`,
				};
			}
			const { edge } = choice;
			await appendEvent(db, {
				type: "EdgeTaken",
				runId,
				payload: {
					edgeId: edge.id,
					from: edge.from,
					to: edge.to,
					outcome,
					scope: frame.scope,
				},
			});
			next = { kind: "node", nodeId: edge.to };
		}
	}

	/**
	 * Opens a step's transcript for appending. `seq` continues the run's
	 * count. Each entry is on disk before it is published on the bus.
	 */
	async function openRecorder(runId: string, stepId: string, path: string) {
		await lastSeqOf(runId);
		const writer = openTranscriptWriter(path);
		return {
			record(sessionId: string | null, stepEvent: StepEvent): void {
				const seq = (lastSeqs.get(runId) ?? 0) + 1;
				lastSeqs.set(runId, seq);
				const entry: TranscriptEntry = {
					seq,
					stepId,
					sessionId,
					at: Date.now(),
					event: stepEvent,
				};
				// On disk first, then on the bus: watchRun depends on this order.
				writer.append(entry);
				bus.publish(runId, { kind: "transcript", entry });
			},
			close: () => writer.close(),
		};
	}

	type Recorder = Awaited<ReturnType<typeof openRecorder>>;

	/** Writes one transcript entry to a step that has no recorder open. */
	async function recordOnce(
		runId: string,
		stepId: string,
		path: string,
		stepEvent: StepEvent,
	): Promise<void> {
		const recorder = await openRecorder(runId, stepId, path);
		try {
			recorder.record(null, stepEvent);
		} finally {
			recorder.close();
		}
	}

	/**
	 * Runs one visit of a node (or reopens or continues a step) and closes it
	 * in the log. A Gate step opens and stays open, and a step that waits for
	 * a usage limit or the network stays open too: both unwind as `paused`.
	 */
	async function runStep(
		ctx: RunContext,
		frame: Frame,
		node: FlowNode,
		start: WalkStart,
		events: readonly LoggedEvent[],
	): Promise<StepResult | Unwind> {
		if (node.type === "foreach") {
			return runForEachStep(ctx, frame, node, start, events);
		}
		const runId = ctx.row.id;
		let stepId: string;
		let path: string;
		let visit: number;

		if (start.kind === "session" || start.kind === "continue") {
			const existing = deriveSteps(events).find((s) => s.id === start.stepId);
			if (!existing) throw new Error(`Step not found: ${start.stepId}`);
			stepId = existing.id;
			path = existing.transcriptPath;
			visit = existing.visit;
			if (start.kind === "session") {
				await appendEvent(db, {
					type: "StepReopened",
					runId,
					stepId,
					payload: { prompt: start.prompt },
				});
			}
		} else {
			stepId = randomUUID();
			path = transcriptPath(dataDir, runId, stepId);
			visit = countVisits(events, node.id, frame.key) + 1;
			const logPath =
				node.type === "command" ? commandLogPath(dataDir, runId, stepId) : null;
			await db.insert(step).values({
				id: stepId,
				runId,
				nodeId: node.id,
				nodeType: node.type,
				visit,
				transcriptPath: path,
			});
			await appendEvent(db, {
				type: "StepStarted",
				runId,
				stepId,
				payload: {
					nodeId: node.id,
					nodeType: node.type,
					visit,
					transcriptPath: path,
					logPath,
					scope: frame.scope,
				},
			});
		}
		bus.publish(runId, { kind: "step-changed", stepId });

		const recorder = await openRecorder(runId, stepId, path);
		if (node.type === "gate") {
			let failure: StepResult | null = null;
			try {
				await openGate({ row: ctx.row, frame, node, stepId, events, recorder });
			} catch (error) {
				failure = {
					outcome: "error",
					outputs: { outcome: "error", note: "", visit },
					error: `The Gate could not open: ${messageOf(error)}`,
				};
			} finally {
				recorder.close();
			}
			if (!failure) return { kind: "unwind", end: { kind: "paused" } };
			await appendEvent(db, {
				type: "StepEnded",
				runId,
				stepId,
				payload: failure,
			});
			bus.publish(runId, { kind: "step-changed", stepId });
			return failure;
		}

		// The step's own signal: a stop of the run, the node's time budget, or
		// no activity for too long.
		const stepController = new AbortController();
		const runSignal = ctx.walk.controller.signal;
		const onStop = () => stepController.abort("stopped" satisfies AbortReason);
		if (runSignal.aborted) onStop();
		else runSignal.addEventListener("abort", onStop, { once: true });
		const timer = node.timeoutMinutes
			? setTimeout(
					() => stepController.abort("timeout" satisfies AbortReason),
					node.timeoutMinutes * minuteMs,
				)
			: undefined;
		const idleMinutes = node.type === "agent" ? node.idleMinutes : undefined;
		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		const touch = () => {
			if (idleMinutes === undefined || stepController.signal.aborted) return;
			clearTimeout(idleTimer);
			idleTimer = setTimeout(
				() => stepController.abort("idle" satisfies AbortReason),
				idleMinutes * minuteMs,
			);
		};
		touch();

		const abortResult = (outputs: StepOutputs): StepResult | null => {
			if (!stepController.signal.aborted) return null;
			const reason = stepController.signal.reason as AbortReason;
			if (reason === "timeout" || reason === "idle") {
				return {
					outcome: "error",
					outputs: { ...outputs, outcome: "error" },
					error:
						reason === "timeout"
							? `The step ran past its time budget of ${node.timeoutMinutes} min.`
							: `No activity for ${idleMinutes} min.`,
				};
			}
			return {
				outcome: "stopped",
				outputs: { ...outputs, outcome: "stopped" },
				error: null,
			};
		};

		let result: StepResult;
		try {
			const tctx = frameContext(ctx.row, frame, events);
			const input: StepRunInput = {
				row: ctx.row,
				frame,
				stepId,
				visit,
				tctx,
				signal: stepController.signal,
				record: recorder.record,
				abortResult,
				touch,
			};
			let raw: StepResult | WaitRequest;
			switch (node.type) {
				case "agent":
					raw = await runAgentStep({ ...input, node, start, events });
					break;
				case "command":
					raw = await runCommandStep({ ...input, node });
					break;
				case "decision":
					raw = await runDecisionStep({ ...input, node });
					break;
			}
			if ("kind" in raw) {
				const waited = await beginWait(ctx, stepId, visit, raw, recorder);
				if ("kind" in waited) return waited;
				result = waited;
			} else {
				result = raw;
			}
		} catch (error) {
			result = {
				outcome: "error",
				outputs: { outcome: "error", visit },
				error: messageOf(error),
			};
		} finally {
			recorder.close();
			clearTimeout(timer);
			clearTimeout(idleTimer);
			runSignal.removeEventListener("abort", onStop);
		}

		await appendEvent(db, {
			type: "StepEnded",
			runId,
			stepId,
			payload: result,
		});
		bus.publish(runId, { kind: "step-changed", stepId });
		return result;
	}

	/**
	 * The run policy: a usage limit or a network failure waits, and the same
	 * step continues later. The wait is a fact in the log; the timer only
	 * carries it out. Gives up (a step error) once the network grace is spent.
	 */
	async function beginWait(
		ctx: RunContext,
		stepId: string,
		visit: number,
		request: WaitRequest,
		recorder: Recorder,
	): Promise<Unwind | StepResult> {
		const runId = ctx.row.id;
		const plan = planWait({
			reason: request.reason,
			streak: waitStreak(await loadRunEvents(runId), stepId, request.reason),
			message: request.message,
			resetAt: request.resetAt,
			policy: ctx.policy,
			now: now(),
			minuteMs,
		});
		if (plan.kind === "give-up") {
			return {
				outcome: "error",
				outputs: { outcome: "error", visit },
				error: plan.error,
				...(request.costUsd !== undefined ? { costUsd: request.costUsd } : {}),
			};
		}
		await appendEvent(db, {
			type: "WaitStarted",
			runId,
			stepId,
			payload: {
				reason: request.reason,
				until: plan.until,
				message: plan.message,
				since: plan.since,
			},
		});
		recorder.record(null, {
			type: "wait",
			reason: request.reason,
			until: plan.until,
			message: plan.message,
		});
		bus.publish(runId, { kind: "step-changed", stepId });
		scheduleWake(runId, plan.until);
		return { kind: "unwind", end: { kind: "paused" } };
	}

	function clearWakeTimer(runId: string): void {
		const timer = wakeTimers.get(runId);
		if (timer !== undefined) clearTimeout(timer);
		wakeTimers.delete(runId);
	}

	function scheduleWake(runId: string, until: number): void {
		clearWakeTimer(runId);
		if (disposed) return;
		const delay = Math.min(Math.max(0, until - now()), MAX_TIMER_MS);
		const timer = setTimeout(() => {
			wakeTimers.delete(runId);
			wake(runId, { early: false }).catch((error) => {
				console.error(`[engine] could not wake run ${runId}`, error);
			});
		}, delay);
		timer.unref?.();
		wakeTimers.set(runId, timer);
	}

	function drainPendingWakes(): void {
		if (disposed) return;
		for (const runId of [...pendingWakes]) {
			pendingWakes.delete(runId);
			wake(runId, { early: false }).catch((error) => {
				console.error(`[engine] could not wake run ${runId}`, error);
			});
		}
	}

	/**
	 * Ends the wait of a sleeping run and continues the step that waited.
	 * `early`: a person resumed the run before its time (a full run cap then
	 * fails); otherwise a full cap queues the wake until a slot frees.
	 */
	async function wake(
		runId: string,
		input: { early: boolean; prompt?: string },
	): Promise<void> {
		if (disposed) return;
		// The walk that began the wait may still be unwinding.
		const slot = slots.get(runId);
		if (slot && slot !== "starting") await slot.done;
		await exclusive(runId, async () => {
			if (disposed) return;
			const events = await loadRunEvents(runId);
			const sleep = deriveSleep(events);
			if (!sleep || deriveRunState(events).status !== "sleeping") return;
			if (!input.early && now() < sleep.until) {
				scheduleWake(runId, sleep.until);
				return;
			}
			clearWakeTimer(runId);
			try {
				reserveSlot(runId);
			} catch (error) {
				if (input.early) throw error;
				pendingWakes.add(runId);
				return;
			}
			try {
				const row = await getRunRow(runId);
				const steps = deriveSteps(events);
				const waiting = steps.find((s) => s.id === sleep.stepId);
				if (!waiting) throw new Error(`Step not found: ${sleep.stepId}`);
				await appendEvent(db, {
					type: "WaitEnded",
					runId,
					stepId: waiting.id,
					payload: { early: input.early },
				});
				await recordOnce(runId, waiting.id, waiting.transcriptPath, {
					type: "wake",
				});
				bus.publish(runId, { kind: "step-changed", stepId: waiting.id });
				launchWalk(
					row,
					wrapInScopes(steps, waiting.scope, {
						kind: "continue",
						stepId: waiting.id,
						nodeId: waiting.nodeId,
						prompt: input.prompt ?? null,
					}),
				);
			} finally {
				releaseStartingSlot(runId);
			}
		});
	}

	/**
	 * Closes the step the run is parked at (an open Gate or a sleeping step)
	 * and the For Each steps around it without an answer, and ends the run
	 * as `stopped`. False when the run is not parked.
	 */
	async function closeParked(runId: string): Promise<boolean> {
		const status = "stopped";
		const parked = parkedSteps(await loadRunEvents(runId));
		if (parked.length === 0) return false;
		clearWakeTimer(runId);
		pendingWakes.delete(runId);
		for (const open of parked) {
			const outputs: StepOutputs =
				open.nodeType === "foreach"
					? forEachOutputs({
							items: open.items,
							visit: open.visit,
							outcome: status,
							waitingCount: 0,
						})
					: open.nodeType === "gate"
						? { outcome: status, note: "", visit: open.visit }
						: { ...open.outputs, outcome: status };
			await appendEvent(db, {
				type: "StepEnded",
				runId,
				stepId: open.id,
				payload: { outcome: status, outputs, error: null },
			});
			bus.publish(runId, { kind: "step-changed", stepId: open.id });
		}
		await endRun(runId, status, null);
		bus.publish(runId, { kind: "status-changed" });
		return true;
	}

	/** Wraps a start inside the For Each steps around `scope`, from the inside out. */
	function wrapInScopes(
		steps: readonly DerivedStep[],
		scope: Scope | null,
		inner: WalkStart,
	): WalkStart {
		const byId = new Map(steps.map((s) => [s.id, s]));
		let start = inner;
		for (let at = scope; at; ) {
			const forEach = byId.get(at.forEachStepId);
			if (!forEach) break;
			start = {
				kind: "foreach",
				nodeId: forEach.nodeId,
				stepId: forEach.id,
				itemId: at.itemId,
				inner: start,
			};
			at = forEach.scope;
		}
		return start;
	}

	/**
	 * Asks the Gate's question. The fact goes in the log first, so the Gate is
	 * open even when the daemon dies before the transcript line is written.
	 */
	async function openGate(input: {
		row: RunRow;
		frame: Frame;
		node: GateNode;
		stepId: string;
		events: readonly LoggedEvent[];
		recorder: Recorder;
	}): Promise<void> {
		const { row, node, stepId, recorder } = input;
		const question = renderTemplate(
			node.question,
			frameContext(row, input.frame, input.events),
		);
		const choices = node.choices.map((c) =>
			c.description === undefined
				? { name: c.name }
				: { name: c.name, description: c.description },
		);
		await appendEvent(db, {
			type: "GateOpened",
			runId: row.id,
			stepId,
			payload: { question, choices },
		});
		recorder.record(null, { type: "gate-open", question, choices });
		bus.publish(row.id, { kind: "step-changed", stepId });
	}

	type StepRunInput = {
		row: RunRow;
		frame: Frame;
		stepId: string;
		visit: number;
		tctx: TemplateContext;
		signal: AbortSignal;
		record: (sessionId: string | null, stepEvent: StepEvent) => void;
		abortResult: (outputs: StepOutputs) => StepResult | null;
		/** Resets the idle clock. */
		touch: () => void;
	};

	async function runAgentStep(
		input: StepRunInput & {
			node: AgentNode;
			start: WalkStart;
			events: readonly LoggedEvent[];
		},
	): Promise<StepResult | WaitRequest> {
		const { row, node, stepId, visit, start, events, signal, record } = input;
		const runId = row.id;

		const render = () => {
			const rendered = renderTemplate(node.prompt, input.tctx);
			return node.skill ? `/${node.skill} ${rendered}`.trim() : rendered;
		};
		let prompt: string;
		let resumeSessionId: string | null;
		if (start.kind === "session") {
			prompt = start.prompt;
			resumeSessionId = start.harnessSessionId;
		} else if (start.kind === "continue") {
			// After a wait: the step's own harness session, if it got one.
			const own = deriveSteps(events).find((s) => s.id === stepId);
			resumeSessionId =
				own?.sessions.findLast((s) => s.harnessSessionId)?.harnessSessionId ??
				null;
			prompt = resumeSessionId
				? (start.prompt ?? DEFAULT_RESUME_PROMPT)
				: render();
		} else {
			prompt = render();
			resumeSessionId =
				node.session === "resume"
					? lastHarnessSessionOfNode(events, node.id, input.frame.key)
					: null;
		}

		const harness: AgentHarness | undefined = harnesses[node.harness];
		if (!harness) {
			return {
				outcome: "error",
				outputs: { outcome: "error", visit },
				error: `No harness is configured for "${node.harness}".`,
			};
		}

		const sessionId = randomUUID();
		await db
			.insert(agentSession)
			.values({ id: sessionId, runId, stepId, prompt });
		await appendEvent(db, {
			type: "SessionStarted",
			runId,
			stepId,
			sessionId,
			payload: { prompt, resumeSessionId },
		});
		bus.publish(runId, { kind: "step-changed", stepId });

		let harnessSessionId: string | null = resumeSessionId;
		let ending: SessionEnding | null = null;
		let report: { outcome: StepReportOutcome; summary: string } | null = null;
		/** The text after the last tool call: the agent's final message. */
		let output = "";
		let afterTool = false;
		let lastMessageId: string | null = null;
		const stoppedByPerson = () => signal.aborted && signal.reason === "stopped";

		const onEvent = async (agentEvent: AgentEvent): Promise<void> => {
			input.touch();
			record(sessionId, agentEvent);
			switch (agentEvent.type) {
				case "session":
					harnessSessionId = agentEvent.sessionId;
					await db
						.update(agentSession)
						.set({ harnessSessionId: agentEvent.sessionId })
						.where(eq(agentSession.id, sessionId));
					await appendEvent(db, {
						type: "HarnessSessionAssigned",
						runId,
						stepId,
						sessionId,
						payload: {
							harnessSessionId: agentEvent.sessionId,
							model: agentEvent.model ?? null,
						},
					});
					bus.publish(runId, { kind: "step-changed", stepId });
					break;
				case "text":
					// The output is the last message: a tool call or a new message starts it over.
					if (afterTool || agentEvent.messageId !== lastMessageId) {
						output = "";
						afterTool = false;
						lastMessageId = agentEvent.messageId;
					}
					output += agentEvent.delta;
					break;
				case "tool-start":
				case "tool-end":
				case "tool-result":
					afterTool = true;
					break;
				case "report":
					afterTool = true;
					report = { outcome: agentEvent.outcome, summary: agentEvent.summary };
					break;
				case "finished":
					ending = {
						outcome: "finished",
						error: null,
						errorKind: null,
						usage: agentEvent.usage ?? null,
						costUsd: agentEvent.usage?.costUsd ?? null,
						resetAt: null,
					};
					break;
				case "error":
					ending = {
						outcome: stoppedByPerson() ? "stopped" : "failed",
						error: agentEvent.message,
						errorKind: agentEvent.kind,
						usage: null,
						costUsd: null,
						resetAt: agentEvent.resetAt ?? null,
					};
					break;
			}
		};

		const endWithoutResult = (message: string): SessionEnding => ({
			outcome: stoppedByPerson() ? "stopped" : "failed",
			error: signal.aborted ? "The session was aborted." : message,
			errorKind: signal.aborted ? "aborted" : "harness",
			usage: null,
			costUsd: null,
			resetAt: null,
		});

		try {
			// A stop that came in while the session was being recorded.
			if (signal.aborted) throw new Error("The session was aborted.");
			const stream = harness.run({
				cwd: row.worktreePath,
				prompt,
				model: node.model,
				permissionMode: node.permissionMode,
				effort: node.effort,
				resumeSessionId: resumeSessionId ?? undefined,
				stepReport: true,
				// A run snapshot from before Slice 3 has no `tools`.
				tools: node.tools ?? [],
				signal,
			});
			await consumeStream(stream, {
				signal,
				graceMs: STOP_GRACE_MS,
				onItem: onEvent,
				isLast: (e) => e.type === "finished" || e.type === "error",
			});
		} catch (error) {
			ending ??= endWithoutResult(messageOf(error));
		}
		const final: SessionEnding =
			ending ?? endWithoutResult("The harness stream ended without a result.");
		await appendEvent(db, {
			type: "SessionEnded",
			runId,
			stepId,
			sessionId,
			payload: final,
		});

		const finalReport = report as {
			outcome: StepReportOutcome;
			summary: string;
		} | null;
		const outputs: StepOutputs = {
			visit,
			output,
			summary: finalReport?.summary || output,
			session_id: harnessSessionId ?? "",
		};
		const aborted = input.abortResult(outputs);
		if (aborted) return aborted;
		if (final.outcome === "failed" && isWaitKind(final.errorKind)) {
			return {
				kind: "wait",
				reason: final.errorKind,
				message: final.error ?? final.errorKind,
				resetAt: final.resetAt,
			};
		}
		if (finalReport) {
			return {
				outcome: finalReport.outcome,
				outputs: { ...outputs, outcome: finalReport.outcome },
				error: null,
			};
		}
		if (final.outcome === "finished") {
			return {
				outcome: "pass",
				outputs: { ...outputs, outcome: "pass" },
				error: null,
			};
		}
		return {
			outcome: "error",
			outputs: { ...outputs, outcome: "error" },
			error: final.error ?? "The harness failed.",
		};
	}

	async function runCommandStep(
		input: StepRunInput & { node: CommandNode },
	): Promise<StepResult> {
		const { row, node, stepId, visit, signal, record } = input;
		const { command, env } = renderCommand(node.command, input.tctx);
		record(null, { type: "command-start", command });
		const result = await runCommand({
			command,
			cwd: row.worktreePath,
			env,
			logPath: commandLogPath(dataDir, row.id, stepId),
			signal,
			onOutput: (stream, text) =>
				record(null, { type: "command-output", stream, text }),
		});
		record(null, { type: "command-exit", exitCode: result.exitCode });

		const outputs: StepOutputs = { visit, log_tail: result.logTail };
		if (result.exitCode !== null) outputs.exit_code = result.exitCode;
		const aborted = input.abortResult(outputs);
		if (aborted) return aborted;
		if (result.spawnError) {
			return {
				outcome: "error",
				outputs: { ...outputs, outcome: "error" },
				error: `The command could not start: ${result.spawnError}`,
			};
		}
		const outcome = result.exitCode === 0 ? "pass" : "fail";
		return { outcome, outputs: { ...outputs, outcome }, error: null };
	}

	async function runDecisionStep(
		input: StepRunInput & { node: DecisionNode },
	): Promise<StepResult | WaitRequest> {
		const { row, node, visit, signal, record } = input;
		const prompt = renderTemplate(node.prompt, input.tctx);
		const labels = node.labels.map((label) => label.name);
		record(null, {
			type: "decision-start",
			prompt,
			labels,
			model: node.model,
		});
		if (!decider) {
			return {
				outcome: "error",
				outputs: { visit, notes: "", outcome: "error" },
				error: "No decider is configured for Decision nodes.",
			};
		}
		const result = await decideWithin(
			decider,
			{
				cwd: row.worktreePath,
				prompt,
				labels: node.labels.map((label) =>
					label.description === undefined
						? { name: label.name }
						: { name: label.name, description: label.description },
				),
				model: node.model,
				tools: node.tools ?? [],
				signal,
			},
			signal,
		);
		const costUsd = result.costUsd;
		if (result.kind === "decided") {
			record(null, {
				type: "decision",
				label: result.label,
				notes: result.notes,
			});
		}
		const outputs: StepOutputs = {
			visit,
			notes: result.kind === "decided" ? result.notes : "",
		};
		const aborted = input.abortResult(outputs);
		if (aborted) return { ...aborted, costUsd };
		if (result.kind === "error") {
			if (isWaitKind(result.errorKind)) {
				return {
					kind: "wait",
					reason: result.errorKind,
					message: result.message,
					resetAt: null,
					costUsd,
				};
			}
			return {
				outcome: "error",
				outputs: { ...outputs, outcome: "error" },
				error: `The decider failed: ${result.message}`,
				costUsd,
			};
		}
		if (!labels.includes(result.label)) {
			return {
				outcome: "error",
				outputs: { ...outputs, outcome: "error" },
				error: `The decider picked "${result.label}", which is not a label of this node. The labels are: ${labels.join(", ")}.`,
				costUsd,
			};
		}
		return {
			outcome: result.label,
			outputs: { ...outputs, outcome: result.label },
			error: null,
			costUsd,
		};
	}

	/**
	 * Reads a For Each source: GitHub sub-issues of the rendered parent, or
	 * the JSON a command prints in the worktree. Throws with a readable message.
	 */
	async function readSource(
		ctx: RunContext,
		frame: Frame,
		node: ForEachNode,
		stepId: string,
		signal: AbortSignal,
	): Promise<SourceItem[]> {
		const row = ctx.row;
		const tctx = frameContext(row, frame, await loadRunEvents(row.id));
		const source = node.source;
		if (source.kind === "github") {
			if (!readGithubItems) {
				throw new Error("No GitHub reader is configured for For Each sources.");
			}
			const text = renderTemplate(source.parent, tctx).trim();
			const parent = Number(text.replace(/^#/, ""));
			if (!Number.isInteger(parent) || parent <= 0) {
				throw new Error(
					`The parent issue "${text}" (from "${source.parent}") is not an issue number.`,
				);
			}
			return readGithubItems({
				cwd: row.worktreePath,
				parent,
				...(source.requireLabel !== undefined
					? { requireLabel: source.requireLabel }
					: {}),
				doneLabels: source.doneLabels ?? [],
				skipLabels: source.skipLabels ?? [],
				signal,
			});
		}
		const { command, env } = renderCommand(source.command, tctx);
		let stdout = "";
		const result = await runCommand({
			command,
			cwd: row.worktreePath,
			env,
			logPath: commandLogPath(dataDir, row.id, stepId),
			signal,
			onOutput: (stream, text) => {
				if (stream === "stdout") stdout += text;
			},
		});
		if (result.spawnError) {
			throw new Error(
				`The source command could not start: ${result.spawnError}`,
			);
		}
		if (result.exitCode !== 0) {
			throw new Error(
				`The source command failed with exit code ${result.exitCode ?? "none"}:\n${result.logTail}`,
			);
		}
		return parseCommandItems(stdout);
	}

	/**
	 * One visit of a For Each node: read the source, mark blocked items, start
	 * the next free item and walk the body for it, then read again. Ends
	 * `done` when no item is left to start, `halted` when a body ends on a
	 * `haltOn` label. A failed item does not fail the step: the items it
	 * blocks are marked blocked and the loop goes on with free work.
	 */
	async function runForEachStep(
		ctx: RunContext,
		frame: Frame,
		node: ForEachNode,
		start: WalkStart,
		events: readonly LoggedEvent[],
	): Promise<StepResult | Unwind> {
		const runId = ctx.row.id;
		const signal = ctx.walk.controller.signal;
		let stepId: string;
		let path: string;
		let visit: number;
		let resume: { itemId: string; inner: WalkStart | null } | null = null;

		if (start.kind === "foreach") {
			const existing = deriveSteps(events).find((s) => s.id === start.stepId);
			if (!existing) throw new Error(`Step not found: ${start.stepId}`);
			stepId = existing.id;
			path = existing.transcriptPath;
			visit = existing.visit;
			if (existing.endedAt !== null) {
				await appendEvent(db, {
					type: "StepReopened",
					runId,
					stepId,
					payload: { prompt: null },
				});
			}
			if (start.itemId !== null) {
				resume = { itemId: start.itemId, inner: start.inner };
			}
		} else {
			stepId = randomUUID();
			path = transcriptPath(dataDir, runId, stepId);
			visit = countVisits(events, node.id, frame.key) + 1;
			await db.insert(step).values({
				id: stepId,
				runId,
				nodeId: node.id,
				nodeType: node.type,
				visit,
				transcriptPath: path,
			});
			await appendEvent(db, {
				type: "StepStarted",
				runId,
				stepId,
				payload: {
					nodeId: node.id,
					nodeType: node.type,
					visit,
					transcriptPath: path,
					logPath:
						node.source.kind === "command"
							? commandLogPath(dataDir, runId, stepId)
							: null,
					scope: frame.scope,
				},
			});
		}
		const changed = () => bus.publish(runId, { kind: "step-changed", stepId });
		changed();

		const record = (stepEvent: StepEvent) =>
			recordOnce(runId, stepId, path, stepEvent);
		const current = async (): Promise<DerivedStep> => {
			const found = deriveSteps(await loadRunEvents(runId)).find(
				(s) => s.id === stepId,
			);
			if (!found) throw new Error(`Step not found: ${stepId}`);
			return found;
		};
		/** The latest read of the source, for `waiting_count`. */
		let lastRead: SourceItem[] | null = null;

		const endStep = async (
			outcome: StepOutcome,
			error: string | null,
		): Promise<StepResult> => {
			const derived = await current();
			const states = itemStates(derived);
			const waitingCount = (lastRead ?? []).filter(
				(item) => !item.done && !Object.hasOwn(states, item.id),
			).length;
			const result: StepResult = {
				outcome,
				outputs: forEachOutputs({
					items: derived.items,
					visit,
					outcome,
					waitingCount,
				}),
				error,
			};
			await appendEvent(db, {
				type: "StepEnded",
				runId,
				stepId,
				payload: result,
			});
			changed();
			return result;
		};
		const unwind = async (end: UnwindEnd): Promise<Unwind> => {
			// A pause keeps the step open: the item continues after the wait.
			if (end.kind === "stopped") await endStep("stopped", null);
			else if (end.kind === "aborted") await endStep("error", end.reason);
			return { kind: "unwind", end };
		};
		const endItem = async (
			itemId: string,
			state: EnginePayloads["ItemEnded"]["state"],
			reason: string | null,
		) => {
			await appendEvent(db, {
				type: "ItemEnded",
				runId,
				stepId,
				payload: { itemId, state, reason },
			});
			await record({ type: "item-end", itemId, state, reason });
			changed();
		};

		const body = ctx.bodyFlows[node.flow];
		if (!body) {
			return endStep(
				"error",
				`The body flow "${node.flow}" is not in the run's snapshot.`,
			);
		}
		const haltOn = node.haltOn ?? ["halt"];
		const branchPerItem = node.branchPerItem ?? true;
		const worktree = ctx.row.worktreePath;

		while (true) {
			let facts: ItemFacts;
			let index: number;
			let branch: string | null;
			let baseBranch: string | null;
			let inner: WalkStart;

			const continuing = resume
				? (await current()).items.findLast(
						(i) => i.facts.id === resume?.itemId && i.open,
					)
				: undefined;
			if (resume && continuing && continuing.index !== null) {
				facts = continuing.facts;
				index = continuing.index;
				branch = continuing.branch;
				baseBranch = continuing.baseBranch;
				inner = resume.inner ?? { kind: "node", nodeId: body.start };
				resume = null;
			} else {
				resume = null;
				if (signal.aborted) return unwind({ kind: "stopped", reason: null });
				const stop = stopBeforeNext(await loadRunEvents(runId));
				if (stop) return unwind({ kind: "stopped", reason: stop });

				let items: SourceItem[];
				try {
					items = await readSource(ctx, frame, node, stepId, signal);
				} catch (error) {
					if (signal.aborted) return unwind({ kind: "stopped", reason: null });
					return endStep("error", messageOf(error));
				}
				const ordered = blockersFirst(items);
				if (!ordered.ok) {
					const byId = new Map(items.map((i) => [i.id, i]));
					const names = ordered.cycle.map((id) =>
						itemLabel({ id, number: byId.get(id)?.number ?? null }),
					);
					return endStep(
						"error",
						`The "blocked by" links of the items make a cycle: ${names.join(" → ")}.`,
					);
				}
				lastRead = ordered.items;
				let derived = await current();
				let states = itemStates(derived);
				const open = ordered.items.filter(
					(item) => !item.done && !Object.hasOwn(states, item.id),
				).length;
				await appendEvent(db, {
					type: "ItemsRead",
					runId,
					stepId,
					payload: { count: items.length, open },
				});
				await record({ type: "items-read", count: items.length, open });

				const blocked = newlyBlocked(ordered.items, states);
				for (const { item, blocker } of blocked) {
					const blockerItem = ordered.items.find((i) => i.id === blocker);
					const reason = `blocked by ${itemLabel({ id: blocker, number: blockerItem?.number ?? null })}`;
					await appendEvent(db, {
						type: "ItemBlocked",
						runId,
						stepId,
						payload: { item: toItemFacts(item), blocker, reason },
					});
					await record({
						type: "item-end",
						itemId: item.id,
						state: "blocked",
						reason,
					});
				}
				if (blocked.length > 0) {
					changed();
					derived = await current();
					states = itemStates(derived);
				}

				const started = derived.items.filter((i) => i.index !== null).length;
				if (node.maxItems !== undefined && started >= node.maxItems) {
					return endStep("done", null);
				}
				const picked = nextItem(ordered.items, states);
				if (picked.kind !== "item") return endStep("done", null);

				facts = toItemFacts(picked.item);
				index = started + 1;
				branch = null;
				baseBranch = null;
				let failure: string | null = null;
				if (branchPerItem) {
					try {
						const startBranch =
							derived.items.find((i) => i.index !== null)?.baseBranch ??
							(await currentBranch(worktree)) ??
							frame.branch;
						baseBranch =
							derived.items.findLast((i) => i.state === "done" && i.branch)
								?.branch ?? startBranch;
						const name = await freeBranchName(
							worktree,
							itemBranchName(runId.slice(0, 8), facts),
						);
						await createAndCheckoutBranch(worktree, name, baseBranch);
						branch = name;
					} catch (error) {
						failure = messageOf(error);
					}
				}
				await appendEvent(db, {
					type: "ItemStarted",
					runId,
					stepId,
					payload: { item: facts, index, branch, baseBranch },
				});
				await record({
					type: "item-start",
					itemId: facts.id,
					title: facts.title,
					branch,
					baseBranch,
				});
				changed();
				if (failure !== null) {
					await endItem(facts.id, "failed", failure);
					continue;
				}
				inner = { kind: "node", nodeId: body.start };
			}

			const itemBranch = branch ?? frame.branch;
			const bodyFrame: Frame = {
				flow: body,
				scope: { forEachStepId: stepId, itemId: facts.id },
				key: scopeKey({ forEachStepId: stepId, itemId: facts.id }),
				branch: itemBranch,
				item: itemTemplateFields({
					facts,
					index,
					branch: itemBranch,
					baseBranch,
				}),
			};
			const end = await walkScope(ctx, bodyFrame, inner);
			if (
				end.kind === "paused" ||
				end.kind === "stopped" ||
				end.kind === "aborted"
			) {
				return unwind(end);
			}
			if (end.kind === "finished" && haltOn.includes(end.outcome)) {
				await endItem(
					facts.id,
					"halted",
					`Ended at node "${end.node.id}" with "${end.outcome}".`,
				);
				return endStep("halted", null);
			}
			if (end.kind === "finished") await endItem(facts.id, "done", null);
			else await endItem(facts.id, "failed", end.reason);
		}
	}

	function shellQuote(value: string): string {
		if (/^[\w@%+=:,./-]+$/.test(value)) return value;
		return `'${value.replaceAll("'", `'\\''`)}'`;
	}

	function toProject(row: typeof project.$inferSelect): Project {
		return {
			id: row.id,
			name: row.name,
			repoPath: row.repoPath,
			createdAt: row.createdAt.getTime(),
		};
	}

	function quickRunTitle(flow: Flow): string {
		const agent = flow.nodes.find((n) => n.type === "agent");
		const text = (agent?.prompt ?? "").replace(/\s+/g, " ").trim();
		if (!text) return QUICK_RUN_TITLE;
		if (text.length <= TITLE_MAX_CHARS) return text;
		return `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
	}

	function refuseErrors(issues: readonly FlowIssue[], what = "The flow"): void {
		const errors = issues.filter((i) => i.severity === "error");
		if (errors.length === 0) return;
		const list = errors.map((e) => `- ${e.message}`).join("\n");
		throw new Error(
			`${what} cannot run. Fix ${errors.length === 1 ? "this error" : `these ${errors.length} errors`} first:\n${list}`,
		);
	}

	/**
	 * Loads, parses and validates the flow a run starts from, and every For
	 * Each body it reaches (by name, from the project's flow files).
	 */
	async function flowsForRun(
		repoPath: string,
		input: StartRunInput,
	): Promise<{
		flow: Flow;
		flowName: string | null;
		bodyFlows: Record<string, Flow>;
	}> {
		const files = await loadAllFlows(repoPath);
		let flow: Flow;
		let flowName: string | null;
		if (input.flowName !== undefined) {
			const loaded = await readFlowFile(repoPath, input.flowName);
			if (!loaded.flow) {
				refuseErrors(loaded.issues);
				throw new Error(`The flow "${input.flowName}" does not parse.`);
			}
			refuseErrors(
				validateFlow(loaded.flow, { flows: files, name: input.flowName }),
			);
			flow = loaded.flow;
			flowName = input.flowName;
		} else {
			const parsed = parseFlow(input.flow, { flows: files });
			refuseErrors(parsed.issues);
			if (!parsed.flow) throw new Error("The flow does not parse.");
			flow = parsed.flow;
			flowName = null;
		}
		if (flow.input === "item") {
			throw new Error(
				"This flow is a For Each body (its input is an item). It runs inside a For Each node, not on its own.",
			);
		}
		const bodyFlows: Record<string, Flow> = {};
		const queue = forEachBodies(flow);
		while (queue.length > 0) {
			const name = queue.shift() as string;
			if (Object.hasOwn(bodyFlows, name)) continue;
			const body = files[name];
			if (!body) {
				throw new Error(
					`The For Each body flow "${name}" ${body === null ? "does not parse" : "does not exist"}.`,
				);
			}
			refuseErrors(
				validateFlow(body, { flows: files, name }),
				`The body flow "${name}"`,
			);
			bodyFlows[name] = body;
			queue.push(...forEachBodies(body));
		}
		return { flow, flowName, bodyFlows };
	}

	const engine: Engine = {
		async listProjects() {
			await ready;
			const rows = await db
				.select()
				.from(project)
				.where(isNull(project.removedAt))
				.orderBy(asc(project.createdAt));
			return rows.map(toProject);
		},

		async addProject(input) {
			await ready;
			const repoPath = await resolveRepoTopLevel(input.repoPath);
			const [existing] = await db
				.select()
				.from(project)
				.where(eq(project.repoPath, repoPath));
			if (existing) {
				if (existing.removedAt === null) return toProject(existing);
				const [restored] = await db
					.update(project)
					.set({ removedAt: null })
					.where(eq(project.id, existing.id))
					.returning();
				if (!restored) throw new Error("Could not restore the project.");
				await appendEvent(db, {
					type: "ProjectRestored",
					payload: { projectId: existing.id },
				});
				return toProject(restored);
			}

			const id = randomUUID();
			const name = input.name ?? repoPath.split("/").at(-1) ?? repoPath;
			const [row] = await db
				.insert(project)
				.values({ id, name, repoPath })
				.returning();
			if (!row) throw new Error("Could not add the project.");
			await appendEvent(db, {
				type: "ProjectAdded",
				payload: { projectId: id, name, repoPath },
			});
			return toProject(row);
		},

		async removeProject(projectId) {
			await ready;
			await getProjectRow(projectId);
			const runs = await db
				.select({ id: run.id })
				.from(run)
				.where(eq(run.projectId, projectId));
			if (runs.some((r) => slots.has(r.id))) {
				throw new Error(
					"A run of this project is still running. Stop it first.",
				);
			}
			for (const r of runs) {
				const status = deriveRunState(await loadRunEvents(r.id)).status;
				if (status === "waiting") {
					throw new Error(
						"A run of this project waits at a Gate. Answer or stop it first.",
					);
				}
				if (status === "sleeping") {
					throw new Error(
						"A run of this project sleeps until a wait ends. Stop it first.",
					);
				}
			}
			// Runs, events and worktrees stay: a person may still need them.
			await db
				.update(project)
				.set({ removedAt: new Date() })
				.where(eq(project.id, projectId));
			await appendEvent(db, {
				type: "ProjectRemoved",
				payload: { projectId },
			});
		},

		async listFlows(projectId) {
			await ready;
			const row = await getProjectRow(projectId);
			return listFlowFiles(row.repoPath);
		},

		async getFlow(projectId, name) {
			await ready;
			const row = await getProjectRow(projectId);
			return readFlowFile(row.repoPath, name);
		},

		async saveFlow(projectId, name, flow) {
			await ready;
			const row = await getProjectRow(projectId);
			return writeFlowFile(row.repoPath, name, flow);
		},

		async deleteFlow(projectId, name) {
			await ready;
			const row = await getProjectRow(projectId);
			await deleteFlowFile(row.repoPath, name);
		},

		async listRuns(input) {
			await ready;
			const query = db.select().from(run);
			const rows = await (input?.projectId
				? query.where(eq(run.projectId, input.projectId))
				: query
			).orderBy(desc(run.createdAt));
			const events = await loadEventsByRun(rows.map((r) => r.id));
			return rows.map((row) => toSummary(row, events.get(row.id) ?? []));
		},

		async getRun(runId) {
			await ready;
			const row = await getRunRow(runId);
			const events = await loadRunEvents(runId);
			const harnessSessionId = lastHarnessSession(events);
			const cli = takeOverCli["claude-code"];
			const detail: RunDetail = {
				...toSummary(row, events),
				flow: parseRunFlow(row),
				bodyFlows: parseBodyFlows(row),
				steps: deriveSteps(events).map(toStepSummary),
				// Edges of the top-level flow; body edges count per item.
				traversals: deriveTraversals(events),
				takeOverCommand: harnessSessionId
					? `cd ${shellQuote(row.worktreePath)} && ${cli} --resume ${shellQuote(harnessSessionId)}`
					: null,
			};
			return detail;
		},

		async startRun(input: StartRunInput) {
			await ready;
			const runId = randomUUID();
			reserveSlot(runId);
			try {
				const projectRow = await getProjectRow(input.projectId);
				const { flow, flowName, bodyFlows } = await flowsForRun(
					projectRow.repoPath,
					input,
				);
				const all = [flow, ...Object.values(bodyFlows)];
				const nodes = all.flatMap((f) => f.nodes);
				if (!decider && nodes.some((n) => n.type === "decision")) {
					throw new Error(
						"The flow has a Decision node, but no decider is configured.",
					);
				}
				if (
					!readGithubItems &&
					nodes.some((n) => n.type === "foreach" && n.source.kind === "github")
				) {
					throw new Error(
						"The flow has a For Each node over GitHub issues, but no GitHub reader is configured.",
					);
				}
				if (input.stopAt !== undefined && input.stopAt <= now()) {
					throw new Error("The stop time has passed already.");
				}
				const params = resolveParams(flow, input.params);
				const title = flowName
					? [flowName, ...Object.entries(params).map(([k, v]) => `${k} ${v}`)]
							.join(" · ")
							.slice(0, 120)
					: quickRunTitle(flow);
				const worktree = await createWorktree({
					repoPath: projectRow.repoPath,
					shortId: runId.slice(0, 8),
					baseRef: input.baseRef,
				});
				const [row] = await db
					.insert(run)
					.values({
						id: runId,
						projectId: projectRow.id,
						flowName,
						flow: JSON.stringify(flow),
						bodyFlows: JSON.stringify(bodyFlows),
						title,
						worktreePath: worktree.worktreePath,
						branch: worktree.branch,
						baseRef: worktree.baseRef,
					})
					.returning();
				if (!row) throw new Error("Could not create the run.");
				await appendEvent(db, {
					type: "RunStarted",
					runId,
					payload: {
						projectId: projectRow.id,
						flowName,
						title,
						start: flow.start,
						stopAt: input.stopAt ?? null,
						params,
					},
				});
				await appendEvent(db, {
					type: "WorktreeCreated",
					runId,
					payload: worktree,
				});
				launchWalk(row, { kind: "node", nodeId: flow.start });
				return toSummary(row, await loadRunEvents(runId));
			} finally {
				releaseStartingSlot(runId);
			}
		},

		async stopRun(runId, stopOptions) {
			await ready;
			await getRunRow(runId);
			if (stopOptions?.when === "after-step") {
				await exclusive(runId, async () => {
					const events = await loadRunEvents(runId);
					const status = deriveRunState(events).status;
					if (
						status !== "running" &&
						status !== "waiting" &&
						status !== "sleeping"
					) {
						return;
					}
					if (deriveStopAfterStep(events)) return;
					await appendEvent(db, {
						type: "StopAfterStepRequested",
						runId,
						payload: {},
					});
					bus.publish(runId, { kind: "status-changed" });
				});
				return;
			}
			await exclusive(runId, async () => {
				const slot = slots.get(runId);
				if (slot === "starting") return;
				let requested = false;
				if (slot) {
					if (!slot.controller.signal.aborted) {
						await appendEvent(db, {
							type: "StopRequested",
							runId,
							payload: {},
						});
						requested = true;
						slot.controller.abort();
					}
					await slot.done;
				}
				// A run that waits at a Gate or sleeps, or reached one while it stopped.
				const status = deriveRunState(await loadRunEvents(runId)).status;
				if (status !== "waiting" && status !== "sleeping") return;
				if (!requested) {
					await appendEvent(db, {
						type: "StopRequested",
						runId,
						payload: {},
					});
				}
				await closeParked(runId);
			});
		},

		async resumeRun(runId, prompt) {
			await ready;
			const row = await getRunRow(runId);
			const before = await loadRunEvents(runId);
			if (deriveRunState(before).status === "sleeping") {
				await wake(runId, {
					early: true,
					...(prompt !== undefined ? { prompt } : {}),
				});
				return;
			}
			reserveSlot(runId);
			try {
				const events = await loadRunEvents(runId);
				const status = deriveRunState(events).status;
				if (status === "running") {
					throw new Error(
						"This run is still running. Stop it or wait for it to end.",
					);
				}
				if (status === "waiting") {
					throw new Error(
						"This run waits at a Gate. Answer the Gate, or stop the run first.",
					);
				}
				if (status === "sleeping") {
					throw new Error(
						"This run sleeps until a wait ends. Resume it again to wake it now.",
					);
				}
				const flow = parseRunFlow(row);
				const point = deriveResumePoint(events);
				const start: WalkStart = point
					? fromResumePoint(point, prompt ?? DEFAULT_RESUME_PROMPT)
					: { kind: "node", nodeId: flow.start };
				const innermost = innermostOf(start);
				const steps = deriveSteps(events);
				const stopAt = deriveStopAt(events);
				await appendEvent(db, {
					type: "RunResumed",
					runId,
					payload: {
						nodeId: innermost.nodeId,
						stepId: innermost.kind === "session" ? innermost.stepId : null,
						prompt: innermost.kind === "session" ? innermost.prompt : null,
						scope: scopeOfStart(steps, start),
						...(stopAt !== null && now() >= stopAt
							? { clearStopAt: true }
							: {}),
					},
				});
				launchWalk(row, start);
			} finally {
				releaseStartingSlot(runId);
			}
		},

		async listGates() {
			await ready;
			// Only runs that ever opened a Gate can wait at one.
			const opened = await db
				.selectDistinct({ runId: event.runId })
				.from(event)
				.where(eq(event.type, "GateOpened" satisfies EngineEventType));
			const runIds = opened.flatMap((r) => (r.runId ? [r.runId] : []));
			if (runIds.length === 0) return [];
			const rows = await db
				.select({ run, projectName: project.name })
				.from(run)
				.innerJoin(project, eq(run.projectId, project.id))
				.where(and(inArray(run.id, runIds), isNull(project.removedAt)));
			const byRun = await loadEventsByRun(
				rows.map((r) => r.run.id),
				LIFECYCLE_EVENT_TYPES,
			);
			const gates: OpenGate[] = [];
			for (const { run: row, projectName } of rows) {
				const gate = deriveOpenGate(byRun.get(row.id) ?? []);
				if (!gate) continue;
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
				});
			}
			return gates.sort((a, b) => a.openedAt - b.openedAt);
		},

		async resolveGate({ runId, stepId, choice, note }) {
			await ready;
			const row = await getRunRow(runId);
			await exclusive(runId, async () => {
				const events = await loadRunEvents(runId);
				const gate = deriveOpenGate(events);
				if (!gate) throw new Error("This run does not wait at a Gate.");
				if (gate.stepId !== stepId) {
					throw new Error(`Step ${stepId} is not the open Gate of this run.`);
				}
				if (!gate.choices.some((c) => c.name === choice)) {
					throw new Error(
						`"${choice}" is not a choice of this Gate. Choose one of: ${gate.choices.map((c) => c.name).join(", ")}.`,
					);
				}
				// The walk continues at once, so it needs a slot. A full cap
				// leaves the Gate open.
				reserveSlot(runId);
				try {
					const text = note ?? "";
					await appendEvent(db, {
						type: "StepEnded",
						runId,
						stepId,
						payload: {
							outcome: choice,
							outputs: { outcome: choice, note: text, visit: gate.visit },
							error: null,
						},
					});
					const steps = deriveSteps(events);
					const gateStep = steps.find((s) => s.id === stepId);
					if (gateStep) {
						await recordOnce(runId, stepId, gateStep.transcriptPath, {
							type: "gate-resolved",
							choice,
							note: text,
						});
					}
					bus.publish(runId, { kind: "step-changed", stepId });
					launchWalk(
						row,
						wrapInScopes(steps, gateStep?.scope ?? null, {
							kind: "outcome",
							nodeId: gate.nodeId,
							outcome: choice,
						}),
					);
				} finally {
					releaseStartingSlot(runId);
				}
			});
		},

		watchRun(runId, { signal, afterSeq }) {
			return watch(runId, signal, afterSeq ?? 0);
		},
	};

	async function* watch(
		runId: string,
		signal: AbortSignal,
		afterSeq: number,
	): AsyncGenerator<RunStreamItem> {
		await ready;
		await getRunRow(runId);
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
			const events = await loadRunEvents(runId);
			let lastStatus: RunStatus = deriveRunState(events).status;
			yield { kind: "status", status: lastStatus };

			const steps = deriveSteps(events);
			for (const derived of steps) {
				if (signal.aborted) return;
				yield { kind: "step", step: toStepSummary(derived) };
			}

			const rows = await db
				.select({ transcriptPath: step.transcriptPath })
				.from(step)
				.where(eq(step.runId, runId));
			const replay = await readRunTranscript(rows.map((s) => s.transcriptPath));
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
					const current = deriveSteps(await loadRunEvents(runId)).find(
						(s) => s.id === item.stepId,
					);
					if (current) yield { kind: "step", step: toStepSummary(current) };
				} else {
					const status = deriveRunState(await loadRunEvents(runId)).status;
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

	return engine;
}

/** The body flow names a flow's For Each nodes run. */
function forEachBodies(flow: Flow): string[] {
	return flow.nodes.flatMap((n) => (n.type === "foreach" ? [n.flow] : []));
}

function fromResumePoint(point: ResumePoint, prompt: string): WalkStart {
	switch (point.kind) {
		case "session":
			return { ...point, prompt };
		case "node":
			return point;
		case "foreach":
			return {
				...point,
				inner: point.inner ? fromResumePoint(point.inner, prompt) : null,
			};
	}
}

/** The deepest start of a chain of For Each starts. */
function innermostOf(start: WalkStart): WalkStart {
	let at = start;
	while (at.kind === "foreach" && at.inner) at = at.inner;
	return at;
}

/** The scope the innermost start runs in. */
function scopeOfStart(
	steps: readonly DerivedStep[],
	start: WalkStart,
): Scope | null {
	let scope: Scope | null = null;
	let at = start;
	while (at.kind === "foreach" && at.inner && at.itemId !== null) {
		scope = { forEachStepId: at.stepId, itemId: at.itemId };
		at = at.inner;
	}
	if (at.kind === "foreach" && !at.inner) {
		// The For Each step itself continues: its own scope.
		return steps.find((s) => s.id === at.stepId)?.scope ?? scope;
	}
	return scope;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Asks the decider, but never waits on it longer than `STOP_GRACE_MS` past
 * an abort: a decider that ignores its signal cannot hold the walk. A decider
 * that throws (against its contract) counts as an error.
 */
async function decideWithin(
	decider: Decider,
	input: DecisionInput,
	signal: AbortSignal,
): Promise<DecisionResult> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const late = new Promise<DecisionResult>((resolve) => {
		onAbort = () => {
			timer = setTimeout(
				() =>
					resolve({
						kind: "error",
						errorKind: "aborted",
						message: "The decider did not stop when it was aborted.",
						costUsd: null,
					}),
				STOP_GRACE_MS,
			);
		};
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([
			decider.decide(input).catch(
				(error): DecisionResult => ({
					kind: "error",
					errorKind: "harness",
					message: messageOf(error),
					costUsd: null,
				}),
			),
			late,
		]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}
