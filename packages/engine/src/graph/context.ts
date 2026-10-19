import { randomUUID } from "node:crypto";
import type { Command, LangGraphRunnableConfig } from "@langchain/langgraph";
import { HARNESS_ADAPTERS } from "@nightshift/agents/doctor";
import type {
	AgentErrorKind,
	AgentHarness,
	Decider,
	HarnessName,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { run, step } from "@nightshift/db/schema/nightshift";
import type {
	AgentNode,
	Flow,
	FlowNode,
	ResolvedPolicy,
	TemplateContext,
} from "@nightshift/flows";
import { eq } from "drizzle-orm";

import type { RunBus } from "../bus";
import type { CliToolGuide } from "../cli-tools";
import {
	countStepsSinceWalkBegan,
	countVisits,
	type DerivedStep,
	deriveSteps,
	deriveStopAfterStep,
	type LoggedEvent,
	type PolicyWaitReason,
	type Scope,
	type StepOutputs,
	scopeKey,
} from "../events";
import type { McpExpansion } from "../mcp";
import { planWait } from "../policy";
import type { RunLog } from "../run-log";
import type { RunSettings } from "../settings";
import {
	commandLogPath,
	openTranscriptWriter,
	readRunTranscript,
	transcriptPath,
} from "../transcripts";
import type { StepEvent, StepOutcome, TranscriptEntry } from "../types";
import { parkCommand, type StepEnd, scopeOf } from "./route";
import type { PendingWait, RunEvent, RunStateValues } from "./state";

/**
 * What every node factory gets (`StepContext`), and the step scaffolding
 * every node shares (`beginStep`, `beginWait`): the entry checks, the
 * `step` row, `StepStarted`/`StepReopened`/`StepEnded`, the transcript
 * recorder, the step and idle timeouts, the bus and the custom stream.
 * Ported from `runStep` and `beginWait` in engine.ts; the log is written
 * exactly as there.
 */

export type RunRow = typeof run.$inferSelect;

/** The run's row, or an error naming the run. */
export async function getRunRow(db: Database, runId: string): Promise<RunRow> {
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error(`Run not found: ${runId}`);
	return row;
}

/** The harness name as a person reads it, for error texts. */
export const HARNESS_LABEL = Object.fromEntries(
	Object.values(HARNESS_ADAPTERS).map((h) => [h.name, h.label]),
) as Record<HarnessName, string>;

/** A harness or decider error the run policy waits out, rather than a failure. */
export const isWaitKind = (
	kind: AgentErrorKind | null | undefined,
): kind is PolicyWaitReason => kind === "usage-limit" || kind === "network";

export const DEFAULT_RESUME_PROMPT = "Continue where you left off.";
export const STOP_TIME_REASON = "Reached the stop time";
export const STOP_AFTER_STEP_REASON =
	"Stopped after the running step, as asked.";
/** How long a stopped harness may take to end its stream. */
export const STOP_GRACE_MS = 5_000;

/** A step's transcript writer. Each entry is on disk, then on the bus, then returned. */
export type Recorder = {
	record(sessionId: string | null, event: StepEvent): TranscriptEntry;
	close(): void;
};

/**
 * What a node factory gets. One per run and per compiled flow: a Call
 * node compiles its called flow with `flow` and `flowName`
 * replaced, everything else shared. Per-invocation facts (the scope, the
 * element's `run` template fields) travel in `config.configurable`:
 *
 * - `configurable.scope: Scope | null`: the calling step and element, null
 *   at the top level. Body nodes stamp it on their events (design rule 6).
 * - `configurable.run?: { branch, base_branch, index }`: the `{{run.*}}`
 *   fields of a Call element (`each`); absent at the top level.
 */
export type StepContext = {
	db: Database;
	/** The run: id, project, worktree, branch, base ref, flow snapshots. */
	run: RunRow;
	/** The flow this graph was compiled from. */
	flow: Flow;
	/** `{{run.flow}}`: the flow's file name, or the run's title for a quick run. */
	flowName: string;
	/** The run's called flows by name (the bodies of Call nodes). */
	flows: Record<string, Flow>;
	/**
	 * The run's policy, resolved at each use like `settings()`: a thread
	 * that stays compiled across a settings change (a run at a Gate for
	 * days, or asleep) plans its waits and checks the step cap with the
	 * current numbers, in bodies too.
	 */
	policy(): ResolvedPolicy;
	/** `append` writes a fact; `events(runId)` reads the log for lookups. */
	log: RunLog;
	bus: RunBus;
	/** Opens a step's transcript for appending; `seq` continues the run's count. */
	recorder(stepId: string, path: string): Promise<Recorder>;
	/** The harness of that name, when it is added and built. */
	harnessFor(name: HarnessName): AgentHarness | undefined;
	decider?: Decider;
	/** An Agent node's MCP servers, expanded. The values go to the harness only. */
	mcpServersFor(
		node: Pick<AgentNode, "connections" | "mcpServers">,
	): Promise<McpExpansion>;
	/** What an agent learns about its CLI tools. Without it: nothing. */
	cliToolsFor?: (names: readonly string[]) => Promise<CliToolGuide[]>;
	/** The run's abort signal: a person stopped the run. */
	signal(): AbortSignal;
	now(): number;
	/** How long one minute of a timeout or a policy wait lasts. 60 000 in production. */
	minuteMs: number;
	dataDir: string;
	settings(): RunSettings;
};

/** A node of the compiled graph: runs one visit and returns where to go next. */
export type NodeAction = (
	state: RunStateValues,
	config: LangGraphRunnableConfig,
) => Promise<Command>;

/** A node factory: what `compileFlow` registers for a flow node. */
export type NodeFactory<N extends FlowNode = FlowNode> = (
	node: N,
	ctx: StepContext,
) => NodeAction;

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Transcript recorders with one seq counter per run, shared by every step
 * of the run (ported from `openRecorder` and `lastSeqOf`). The runner makes
 * one per daemon and binds `StepContext.recorder` to the run.
 */
export function createRecorders(input: { db: Database; bus: RunBus }) {
	const { db, bus } = input;
	/** The last transcript seq written per run. Loaded from disk on first use. */
	const lastSeqs = new Map<string, number>();

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

	return {
		async open(runId: string, stepId: string, path: string): Promise<Recorder> {
			await lastSeqOf(runId);
			const writer = openTranscriptWriter(path);
			return {
				record(sessionId, stepEvent) {
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
					return entry;
				},
				close: () => writer.close(),
			};
		},
	};
}

/** Templates of a node read the state's node outputs, the inputs and the run. */
function templateContext(
	ctx: StepContext,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): TemplateContext {
	const fields = (config.configurable?.run as
		| { branch: string; base_branch: string; index: string }
		| undefined) ?? { branch: ctx.run.branch, base_branch: "", index: "" };
	return {
		nodes: state.nodes,
		inputs: state.inputs,
		run: {
			...fields,
			worktree: ctx.run.worktreePath,
			base_ref: ctx.run.baseRef,
			flow: ctx.flowName,
		},
	};
}

/** Writes to LangGraph's `custom` stream, when the run is streamed. */
export function emit(config: LangGraphRunnableConfig, event: RunEvent): void {
	config.writer?.(event);
}

/**
 * The step of this node the log has but the graph never committed: the
 * daemon died while it ran (design rule 5). The graph's `visits` count the
 * node's committed visits; the log counts one more while a step runs.
 * Recovery ends it `interrupted`; a node that re-runs may continue it.
 */
export function uncommittedStep(
	node: FlowNode,
	state: RunStateValues,
	events: readonly LoggedEvent[],
	scope: Scope | null,
): DerivedStep | null {
	const key = scopeKey(scope);
	const logged = countVisits(events, node.id, key);
	if (logged <= (state.visits[node.id] ?? 0)) return null;
	return (
		deriveSteps(events).findLast(
			(s) => s.nodeId === node.id && scopeKey(s.scope) === key,
		) ?? null
	);
}

/**
 * The run's stop time as this graph sees it (epoch ms, or null). The root
 * reads its state; a body reads its caller's, which `runBody` puts in
 * `configurable.stopAt` on every invoke, so a stop time a resume cleared
 * at the root reaches a body that resumes from its own checkpoint. None
 * while the graph wraps the run up after a `stopped` edge (`wrappingUp`).
 */
export function stopAtOf(
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): number | null {
	if (state.wrappingUp) return null;
	const own = config.configurable?.stopAt as number | null | undefined;
	return own === undefined ? state.stopAt : own;
}

/** Why a step's signal aborted. */
export type AbortReason = "stopped" | "timeout" | "idle";

/**
 * How a node enters: a new visit (the default), or an existing step of the
 * node: `reopen` appends `StepReopened` (a person resumed a parked step, or
 * the daemon re-runs the node after a restart); `continue` appends nothing
 * (the step waited, and the wait ended). A `quiet` continue also tells the
 * bus and the custom stream nothing: the step did not start again (a Gate
 * that ends on its answer).
 */
export type StepStart =
	| { kind: "new" }
	| { kind: "reopen"; stepId: string; prompt: string | null }
	| { kind: "continue"; stepId: string; quiet?: boolean };

/** A step in progress: what the node body needs, and how it ends. */
export type StepHandle = {
	stepId: string;
	visit: number;
	/** The transcript path. */
	path: string;
	scope: Scope | null;
	/** `scopeKey(scope)`: for the per-scope derivations of events.ts. */
	key: string;
	/** How the step was opened. */
	opened: StepStart["kind"];
	/** The log as read on entry, before this step's own events. */
	events: readonly LoggedEvent[];
	/** The step as the log had it, for a reopened or continued step. */
	existing: DerivedStep | null;
	tctx: TemplateContext;
	/** The step's own signal: a stop of the run, the node's time budget, or no activity for too long. */
	signal: AbortSignal;
	/** Writes one transcript entry (on disk, on the bus, on the custom stream). */
	record(sessionId: string | null, event: StepEvent): void;
	/** Resets the idle clock (Agent nodes with `idleMinutes`). */
	touch(): void;
	/** The result an aborted step ends with, or null while the signal is quiet. */
	abortResult(outputs: StepOutputs): StepEnd | null;
	/**
	 * Closes the step: `StepEnded` in the log, the recorder and the timers
	 * closed, the bus and the custom stream told. The node then routes on
	 * the returned end (`route()`).
	 */
	end(
		outcome: StepOutcome,
		outputs: StepOutputs,
		error: string | null,
		extra?: { costUsd?: number | null; harnessSessionId?: string | null },
	): Promise<StepEnd>;
	/** Closes the recorder and the timers but leaves the step open in the log (a wait). */
	leaveOpen(): void;
};

/** What `beginStep` gives: a step to run, or the run parked before it. */
export type BeginStep =
	| { kind: "step"; step: StepHandle }
	| { kind: "parked"; command: Command };

/**
 * Opens a step of `node` and returns what the node body needs. For a new
 * visit it first runs the walk's entry checks, in this order, and parks
 * the run when one fires: a stop of the run (stopped, no reason), a stop
 * after the running step, the stop time (both stopped, with today's
 * reasons), and the step cap (failed, with today's reason). A continued
 * or reopened step skips them all: it is already in the log, and a stop
 * must end it there (the old walk had no entry check for one). It then writes
 * the `step` row and `StepStarted` (with the transcript path, the command
 * log path and the scope), or `StepReopened` for a reopen, and opens the
 * transcript and the timers. Exactly `runStep`'s scaffolding.
 */
export async function beginStep(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	start: StepStart = { kind: "new" },
): Promise<BeginStep> {
	const runId = ctx.run.id;
	const scope = scopeOf(config);
	const key = scopeKey(scope);
	const events = await ctx.log.events(runId);
	const parked = (
		status: "failed" | "stopped",
		reason: string | null,
		atStopTime = false,
	) => ({
		kind: "parked" as const,
		command: parkCommand({ node, status, reason, step: null, atStopTime }),
	});

	let stepId: string;
	let path: string;
	let visit: number;
	let existing: DerivedStep | null = null;
	if (start.kind === "new") {
		// Only a new visit parks before its step: a continued or reopened step
		// enters the node body with the aborted signal, so it ends `stopped`
		// with its session and a later resume can reopen it.
		if (ctx.signal().aborted) return parked("stopped", null);
		if (deriveStopAfterStep(events)) {
			return parked("stopped", STOP_AFTER_STEP_REASON);
		}
		const stopAt = stopAtOf(state, config);
		if (stopAt !== null && ctx.now() >= stopAt) {
			return parked("stopped", STOP_TIME_REASON, true);
		}
		const limit = ctx.policy().maxSteps ?? ctx.settings().maxStepsPerRun;
		if (countStepsSinceWalkBegan(events) >= limit) {
			return parked(
				"failed",
				`The run reached the limit of ${limit} steps before node "${node.id}". Resume it to continue.`,
			);
		}
		stepId = randomUUID();
		path = transcriptPath(ctx.dataDir, runId, stepId);
		visit = countVisits(events, node.id, key) + 1;
		const logPath =
			node.type === "command" ||
			(node.type === "call" && node.each?.source.kind === "command") ||
			(node.type === "wait" && node.until.kind === "command")
				? commandLogPath(ctx.dataDir, runId, stepId)
				: null;
		await ctx.db.insert(step).values({
			id: stepId,
			runId,
			nodeId: node.id,
			nodeType: node.type,
			visit,
			transcriptPath: path,
		});
		await ctx.log.append({
			type: "StepStarted",
			runId,
			stepId,
			payload: {
				nodeId: node.id,
				nodeType: node.type,
				visit,
				transcriptPath: path,
				logPath,
				scope,
			},
		});
	} else {
		existing = deriveSteps(events).find((s) => s.id === start.stepId) ?? null;
		if (!existing) throw new Error(`Step not found: ${start.stepId}`);
		stepId = existing.id;
		path = existing.transcriptPath;
		visit = existing.visit;
		if (start.kind === "reopen") {
			await ctx.log.append({
				type: "StepReopened",
				runId,
				stepId,
				payload: { prompt: start.prompt },
			});
		}
	}
	if (!(start.kind === "continue" && start.quiet)) {
		ctx.bus.publish(runId, { kind: "step-changed", stepId });
		emit(config, {
			type: "step-started",
			stepId,
			nodeId: node.id,
			visit,
			reopened: start.kind !== "new",
		});
	}

	const recorder = await ctx.recorder(stepId, path);

	// The step's own signal: a stop of the run, the node's time budget, or
	// no activity for too long.
	const stepController = new AbortController();
	const runSignal = ctx.signal();
	const onStop = () => stepController.abort("stopped" satisfies AbortReason);
	if (runSignal.aborted) onStop();
	else runSignal.addEventListener("abort", onStop, { once: true });
	// A Gate (a Decision decided by a person) waits as long as it must. A
	// Wait node keeps its own deadline across its sleeps (graph/nodes/wait.ts).
	const timeoutMinutes =
		(node.type === "decision" && node.by === "person") || node.type === "wait"
			? undefined
			: node.timeoutMinutes;
	const timer = timeoutMinutes
		? setTimeout(
				() => stepController.abort("timeout" satisfies AbortReason),
				timeoutMinutes * ctx.minuteMs,
			)
		: undefined;
	const idleMinutes = node.type === "agent" ? node.idleMinutes : undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const touch = () => {
		if (idleMinutes === undefined || stepController.signal.aborted) return;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(
			() => stepController.abort("idle" satisfies AbortReason),
			idleMinutes * ctx.minuteMs,
		);
	};
	touch();

	let closed = false;
	const leaveOpen = () => {
		if (closed) return;
		closed = true;
		recorder.close();
		clearTimeout(timer);
		clearTimeout(idleTimer);
		runSignal.removeEventListener("abort", onStop);
	};

	const abortResult = (outputs: StepOutputs): StepEnd | null => {
		if (!stepController.signal.aborted) return null;
		const reason = stepController.signal.reason as AbortReason;
		if (reason === "timeout" || reason === "idle") {
			return {
				stepId,
				visit,
				outcome: "error",
				outputs: { ...outputs, outcome: "error" },
				error:
					reason === "timeout"
						? `The step ran past its time budget of ${node.timeoutMinutes} min.`
						: `No activity for ${idleMinutes} min.`,
			};
		}
		return {
			stepId,
			visit,
			outcome: "stopped",
			outputs: { ...outputs, outcome: "stopped" },
			error: null,
		};
	};

	const handle: StepHandle = {
		stepId,
		visit,
		path,
		scope,
		key,
		opened: start.kind,
		events,
		existing,
		tctx: templateContext(ctx, state, config),
		signal: stepController.signal,
		record(sessionId, stepEvent) {
			const entry = recorder.record(sessionId, stepEvent);
			emit(config, { type: "transcript", entry });
		},
		touch,
		abortResult,
		async end(outcome, outputs, error, extra) {
			leaveOpen();
			await ctx.log.append({
				type: "StepEnded",
				runId,
				stepId,
				payload: {
					outcome,
					outputs,
					error,
					...(extra?.costUsd !== undefined ? { costUsd: extra.costUsd } : {}),
				},
			});
			ctx.bus.publish(runId, { kind: "step-changed", stepId });
			emit(config, {
				type: "step-ended",
				stepId,
				nodeId: node.id,
				visit,
				outcome,
			});
			return {
				stepId,
				visit,
				outcome,
				outputs,
				error,
				...(extra?.harnessSessionId !== undefined
					? { harnessSessionId: extra.harnessSessionId }
					: {}),
			};
		},
		leaveOpen,
	};
	return { kind: "step", step: handle };
}

/** An Agent step, or a Decision step decided by a model, that hit a usage limit or lost the network. */
export type WaitRequest = {
	reason: PolicyWaitReason;
	/** The harness's error message. */
	message: string;
	resetAt: number | null;
	/** The harness session the step continues after the wait, if it has one. */
	harnessSessionId: string | null;
};

/** Why the run stopped instead of waiting: the wait would end after the stop time. */
function stopTimeWaitReason(request: WaitRequest): string {
	return request.reason === "usage-limit"
		? `Usage limit: ${request.message}. It resets after the stop time, so the run stopped. Resume the run to continue.`
		: `The network is down: ${request.message}. The next try is after the stop time, so the run stopped. Resume the run to continue.`;
}

/** True when the run has a stop time and it has passed. */
export function pastStopTime(
	ctx: StepContext,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): boolean {
	const stopAt = stopAtOf(state, config);
	return stopAt !== null && ctx.now() >= stopAt;
}

/**
 * The run policy's wait (ported from `beginWait`): plans it with `planWait`
 * from the step's wait streak. A wait that would end after the run's stop
 * time is not started: the node ends the step `stopped` and parks the run
 * (`stop-time`, with why). On a wait, appends `WaitStarted`, records the
 * transcript `wait` entry, tells the bus and leaves the step open. The node
 * then jumps to its wait node with the returned `pending`; the wait node
 * interrupts; a wake re-enters the node, which continues the step. The
 * runner appends `WaitEnded` and the transcript `wake` entry on the wake,
 * not the node. Gives up (the step ends `error`) once the grace is spent.
 *
 * The streak is the one the step's pending wait carries (`pending.streak`)
 * when the step continues after a wait for the same reason; a new or
 * reopened step, or the other reason, starts a new one.
 */
export async function beginWait(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	step: StepHandle,
	request: WaitRequest,
): Promise<
	| { kind: "wait"; pending: PendingWait }
	| { kind: "give-up"; error: string }
	| { kind: "stop-time"; reason: string }
> {
	const runId = ctx.run.id;
	const previous = state.pending;
	const streak =
		step.opened === "continue" &&
		previous?.kind === "wait" &&
		previous.stepId === step.stepId &&
		previous.reason === request.reason
			? previous.streak
			: null;
	const plan = planWait({
		reason: request.reason,
		streak,
		message: request.message,
		resetAt: request.resetAt,
		policy: ctx.policy(),
		now: ctx.now(),
		minuteMs: ctx.minuteMs,
	});
	if (plan.kind === "give-up") return { kind: "give-up", error: plan.error };
	// A wait that ends after the stop time would only continue the step past
	// it: the run stops now, and a resume continues the step.
	const stopAt = stopAtOf(state, config);
	if (stopAt !== null && plan.until >= stopAt) {
		return { kind: "stop-time", reason: stopTimeWaitReason(request) };
	}
	await ctx.log.append({
		type: "WaitStarted",
		runId,
		stepId: step.stepId,
		payload: {
			reason: request.reason,
			until: plan.until,
			message: plan.message,
			since: plan.since,
		},
	});
	step.record(null, {
		type: "wait",
		reason: request.reason,
		until: plan.until,
		message: plan.message,
	});
	ctx.bus.publish(runId, { kind: "step-changed", stepId: step.stepId });
	step.leaveOpen();
	return {
		kind: "wait",
		pending: {
			kind: "wait",
			stepId: step.stepId,
			nodeId: node.id,
			visit: step.visit,
			harnessSessionId: request.harnessSessionId,
			prompt: DEFAULT_RESUME_PROMPT,
			reason: request.reason,
			until: plan.until,
			message: plan.message,
			resetAt: request.resetAt,
			streak: { count: (streak?.count ?? 0) + 1, since: plan.since },
		},
	};
}
