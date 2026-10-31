import type { Command, LangGraphRunnableConfig } from "@langchain/langgraph";
import { harnessLabel } from "@nightshift/agents/harness-facts";
import type { AgentErrorKind } from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { step } from "@nightshift/db/schema";
import type {
	Flow,
	FlowNode,
	Outcome,
	ResolvedPolicy,
	TemplateContext,
} from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { LeaseAnswer } from "../contract";
import type { Capabilities, Device } from "../device";
import type { RunSettings } from "../device-config";
import {
	type DerivedStep,
	openTranscriptWriter,
	type PolicyWaitReason,
	type RunBus,
	type RunLog,
	type RunRow,
	readRunTranscript,
	type Scope,
	type StepEvent,
	type StepOutputs,
	type TranscriptEntry,
	transcriptPath,
	transcriptToRead,
} from "../log";
import type { RunResult } from "../run-status";
import type { KeptFlow } from "../variables";
import type { Races } from "./branches";
import type { ResumeRules } from "./resume-point";
import type { RunEvent, RunStateValues } from "./state";

/**
 * What every node factory gets (`StepContext`) and what every node module
 * gives back (`NodeKind`, the descriptor the registry in `node-kinds.ts`
 * lists), the transcript recorders,
 * the template context and the stop time as a graph sees it. The step
 * lifecycle itself (the entry checks, the `step` row,
 * `StepStarted`/`StepReopened`/`StepEnded`, the timers, the abort
 * translation, the routing) is the step runner's (`graph/step-runner.ts`);
 * a step's sleep and wake are the sleep module's (`graph/sleep.ts`). The
 * log is written exactly as the old engine wrote it.
 */

/**
 * A harness's display name, for a message about one that is not added (no
 * `AgentHarness` instance to ask). Sourced from the port side
 * (`@nightshift/agents/harness-facts`), not the adapter registry.
 */
export { harnessLabel };

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
 * replaced (and `deviceFor`, for a Subflow that names a computer),
 * everything else shared. Per-invocation facts (the scope, the
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
	/**
	 * `append` writes a fact, through the drive's fence (`fence.ts`), in one
	 * batch with the row it names: a stop never leaves a row without its
	 * event. `events(runId)` reads the log for lookups.
	 */
	log: RunLog;
	bus: RunBus;
	/**
	 * Opens a step's transcript in this computer's data folder for
	 * appending; `seq` continues the run's count.
	 */
	recorder(stepId: string): Promise<Recorder>;
	/**
	 * The Device a step of `node` runs on (its Placement). The step runner
	 * asks once per step and hands the Device to the body; no body touches
	 * a harness, a process, an MCP client or the decider itself.
	 */
	deviceFor(node: FlowNode, run: RunRow): Device;
	/** A Device by id, as a step of the run reaches it: where its work is now, for a Hand-off. */
	deviceById(id: string, run: RunRow): Device;
	/** The run's abort signal: a person stopped the run. */
	signal(): AbortSignal;
	now(): number;
	/** How long one minute of a timeout or a policy wait lasts. 60 000 in production. */
	minuteMs: number;
	dataDir: string;
	settings(): RunSettings;
	/**
	 * The descriptor of a node's kind (`node-kinds.ts`). The registry comes
	 * in by the context, so the engine around the nodes never imports the
	 * node modules: they import it.
	 */
	kindOf(node: FlowNode): NodeKind;
	/**
	 * The race of the `first` Joins of this thread and the running steps of
	 * branches it may stop (`branches.ts`). A body shares its caller's.
	 */
	races: Races;
	/**
	 * Takes a lease of the run's Space for the run (ADR 7): the engine's
	 * keeper, which asks this Replica's store or the Space's Host.
	 */
	leases: LeaseTaker;
};

/** How a Lease node takes its lease (`StepContext.leases`). */
export type LeaseTaker = {
	take(
		run: Pick<RunRow, "id" | "spaceId" | "title">,
		input: { name: string; ttlMinutes?: number },
	): Promise<LeaseAnswer>;
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

/*
 * The node-kind descriptor: what a node module says about its kind, so the
 * engine around it asks instead of switching on `node.type`. The design and
 * the deletion test that picked these members are in `node-kinds.ts`.
 */

/** An auxiliary graph node a flow node needs besides its park node (`compile.ts`). */
export type Aux<N extends FlowNode = FlowNode> =
	/** `wait__<id>`: the sleep module's wait node (rule 8). */
	| { kind: "wait" }
	/** `ask__<id>`: a node that interrupts and routes on the answer (the Gate). */
	| { kind: "ask"; make: NodeFactory<N> };

/** A step's time budget: the step timer, and the idle timer an Agent step has. */
export type TimeBudget = {
	timeoutMinutes: number | undefined;
	idleMinutes: number | undefined;
};

/**
 * One requirement of a run's nodes on the Device: the message that refuses
 * the run, or null when the Device has what the nodes need (its
 * `capabilities`, with the programs the nodes name looked up). A kind's own
 * requirement gets the nodes of its kind only.
 */
export type Requirement<N extends FlowNode = FlowNode> = (
	nodes: readonly N[],
	has: Capabilities,
) => string | null;

/**
 * Where a refusal's Device is, for its message: "" on this computer, else
 * " on <name>" ("… no connection has that name on hetzner-1").
 */
export function onDevice(has: Pick<Capabilities, "elsewhere">): string {
	return has.elsewhere === null ? "" : ` on ${has.elsewhere}`;
}

/**
 * One node kind as the engine sees it. `N` is the kind's flow node; a fact
 * may depend on `node.by` (Decision, Value) or `node.each` (Call).
 */
export type NodeKind<N extends FlowNode = FlowNode> = {
	type: N["type"];
	/** The graph node that runs one visit (`compile.ts`). */
	make: NodeFactory<N>;
	/** Which existing step a visit takes up (`RESUME_RULES`), as the factory passes it to the step runner. */
	resumeRules(node: N): ResumeRules;
	/** The auxiliary graph nodes `compile.ts` adds besides the park node. */
	aux(node: N): readonly Aux<N>[];
	/**
	 * Whether ending with `outcome` and no edge is a chosen end of the flow
	 * (`route()`): `ended` is set and the graph reaches END. Else the step
	 * is a failure with no edge.
	 */
	isChosenEnd(node: N, outcome: Outcome): boolean;
	/**
	 * The `RunEnded` reason of a chosen end: null for the flow's plain end,
	 * else which node and outcome, or what the node says (`outputs`, the
	 * step's outputs: an End node's message).
	 */
	endReason(node: N, outcome: Outcome, outputs: StepOutputs): string | null;
	/**
	 * The result a chosen end gives the run (`RunEnded.result`): an End
	 * node's status. Null for every other end.
	 */
	endResult(node: N, outcome: Outcome): RunResult | null;
	/** A Call's `ended` output when its flow ended at this node: the label, or "". */
	endedLabel(node: N, outcome: Outcome): string;
	/** Whether a step of this node writes a command log (`StepStarted.logPath`). */
	logsCommandOutput(node: N): boolean;
	/**
	 * The step's timers (`beginStep`), and the idle minutes an abort names.
	 * `policy`: the run's, for a limit the node leaves to it (an Agent's
	 * idle limit).
	 */
	timeBudget(node: N, policy: Pick<ResolvedPolicy, "idleMinutes">): TimeBudget;
	/**
	 * The outputs an open step of this node ends with when its work is cut
	 * short (`closeOpenWork`): a stop, a missed deadline, or a daemon that
	 * died. `outcome` is the step's outcome then. `node` is undefined when
	 * the run's flow snapshot has no node for the step.
	 */
	cutShortOutputs(
		open: DerivedStep,
		node: N | undefined,
		outcome: CutShortOutcome,
	): StepOutputs;
	/** The connections the node needs the Device to have (`run-start.connectionsExist`). */
	connections(node: N): readonly string[];
	/** The programs the node needs on the Device, looked up before its requirements run. */
	programs(node: N): readonly string[];
	/** The start-time requirements about this kind, in the order a person sees them. */
	requirements: readonly Requirement<N>[];
	/**
	 * What a step of this node needs of its Device: `worktree` (it works in
	 * the run's worktree there: the work is handed off to that Device
	 * first), `device` (it asks the Device only: a model, a tool), or null
	 * (it needs no computer: a Gate, a rule, a timer).
	 */
	works(node: N): "worktree" | "device" | null;
};

/** The outcome of a step whose work was cut short: stopped, overdue (`error`), or interrupted. */
export type CutShortOutcome = "stopped" | "error" | "interrupted";

/** The `RunEnded` reason of a chosen end that is not the flow's plain end. */
export function endedAtReason(node: FlowNode, outcome: Outcome): string {
	return `Ended at node "${node.id}" with "${outcome}".`;
}

/**
 * The facts most kinds share, for a kind to spread and override: no
 * auxiliary node, `pass` is the one chosen end and the plain end, no
 * label for a Call, no command log, the node's own `timeoutMinutes`, a
 * cut-short step keeps its outputs, no connections, no programs, no
 * requirements.
 */
export const PLAIN_KIND = {
	aux: () => [],
	isChosenEnd: (_node, outcome) => outcome === "pass",
	endReason: (node, outcome) =>
		outcome === "pass" ? null : endedAtReason(node, outcome),
	endResult: () => null,
	endedLabel: () => "",
	logsCommandOutput: () => false,
	timeBudget: (node) => ({
		timeoutMinutes: node.timeoutMinutes,
		idleMinutes: undefined,
	}),
	cutShortOutputs: (open, _node, outcome) => ({ ...open.outputs, outcome }),
	connections: () => [],
	programs: () => [],
	requirements: [],
	works: () => null,
} satisfies Omit<NodeKind, "type" | "make" | "resumeRules">;

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The words a person sees for an error that ends a step: a refusal keeps
 * its own. Any other error is a failure: plain words (`wordsFor`), and the
 * error goes to the log, with `where` it happened.
 */
export function stepFailure(error: unknown, where: string): string {
	if (!(error instanceof Refusal)) {
		console.error(`[engine] ${where} failed:`, error);
	}
	return wordsFor(error);
}

/**
 * Transcript recorders with one seq counter per run, shared by every step
 * of the run (ported from `openRecorder` and `lastSeqOf`). The runner makes
 * one per daemon and binds `StepContext.recorder` to the run.
 */
export function createRecorders(input: {
	db: Database;
	bus: RunBus;
	dataDir: string;
}) {
	const { db, bus, dataDir } = input;
	/** The last transcript seq written per run. Loaded from disk on first use. */
	const lastSeqs = new Map<string, number>();
	/** The last seq another Walker wrote of a run moved here: its files are not on this disk. */
	const movedSeqs = new Map<string, number>();

	async function lastSeqOf(runId: string): Promise<number> {
		const known = lastSeqs.get(runId);
		if (known !== undefined) return known;
		const rows = await db
			.select({ id: step.id, transcriptPath: step.transcriptPath })
			.from(step)
			.where(eq(step.runId, runId));
		const entries = await readRunTranscript(
			rows.map((r) => transcriptToRead(dataDir, runId, r.id, r.transcriptPath)),
		);
		const last = entries.at(-1)?.seq ?? 0;
		// A step of this run may have written meanwhile; keep the larger.
		const current = Math.max(
			last,
			lastSeqs.get(runId) ?? 0,
			movedSeqs.get(runId) ?? 0,
		);
		lastSeqs.set(runId, current);
		movedSeqs.delete(runId);
		return current;
	}

	return {
		/**
		 * A run another Device walked until now: its next entry comes after
		 * `seq`, the last one that Device wrote. A seq known here already
		 * (the run walked here before) is kept when it is larger.
		 */
		continueAfter(runId: string, seq: number): void {
			const known = lastSeqs.get(runId);
			if (known !== undefined) lastSeqs.set(runId, Math.max(known, seq));
			else movedSeqs.set(runId, Math.max(movedSeqs.get(runId) ?? 0, seq));
		},
		async open(runId: string, stepId: string): Promise<Recorder> {
			await lastSeqOf(runId);
			const writer = openTranscriptWriter(
				transcriptPath(dataDir, runId, stepId),
			);
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

/**
 * Whose kept variables this graph reads and writes: the run's project and
 * the flow's file name. A called flow (`scope` set) keeps its own, by its
 * name. A quick run has no flow file, so it keeps nothing (null).
 */
export function keptFlowOf(
	ctx: Pick<StepContext, "run" | "flowName">,
	scope: Scope | null,
): KeptFlow | null {
	const flowName = scope === null ? ctx.run.flowName : ctx.flowName;
	if (flowName === null) return null;
	return { spaceId: ctx.run.spaceId, projectId: ctx.run.projectId, flowName };
}

/** Templates of a node read the state's node outputs, the inputs, the variables and the run. */
export function templateContext(
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
		vars: state.vars,
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

/** True when the run has a stop time and it has passed. */
export function pastStopTime(
	ctx: StepContext,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): boolean {
	const stopAt = stopAtOf(state, config);
	return stopAt !== null && ctx.now() >= stopAt;
}
