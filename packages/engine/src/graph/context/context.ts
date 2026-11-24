import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { harnessLabel } from "@nightshift/agents/harness-facts";
import type { AgentErrorKind } from "@nightshift/agents/types";
import type {
	Flow,
	FlowNode,
	JsonValue,
	ResolvedPolicy,
	TemplateContext,
	VariableType,
} from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import type { ArtifactStore } from "../../artifacts";
import type { LeaseAnswer, WalkSettings } from "../../contract";
import type { Device, GitAuthor } from "../../device";
import type {
	PolicyWaitReason,
	RunBus,
	RunLog,
	RunRow,
	Scope,
	ServiceHold,
	ServiceSpec,
} from "../../log";
import type { MemoryAt, Remembered } from "../../memory";
import type { UsageNotes } from "../../usage";
import type { KeptFlow } from "../../variables";
import type { Races } from "../branches";
import type { Recorders } from "../recorders";
import type { RunEvent, RunStateValues } from "../state";
import type { NodeKind } from "./node-kind";

/**
 * What every step may touch (`StepShared`) and what every node factory gets
 * (`StepContext`), the template context and the stop time as a graph sees
 * it. What every node module gives back (`NodeKind`) is in `node-kind.ts`,
 * and the transcript recorders are in `recorders/`.
 * The step lifecycle itself (the entry checks,
 * `StepStarted`/`StepReopened`/`StepEnded`, the timers, the abort
 * translation, the routing) is the step runner's (`step/step-runner.ts`);
 * a step's sleep and wake are the sleep module's (`step/sleep.ts`). The
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

/**
 * What a step may touch on this computer, the same for every run: the
 * engine makes it once (`createEngine`), the runner hands it to every
 * Thread, and a Thread adds the run's own (`StepContext`). Each member
 * takes the run it works for; none is the database or a folder on disk.
 */
export type StepShared = {
	/**
	 * `append` writes a fact in one batch with the rows it implies and the
	 * rows it names: a stop never leaves a row without its event. In a
	 * StepContext it is the thread's fenced one (`fence.ts`).
	 * `events(runId)` reads the log for lookups.
	 */
	log: RunLog;
	bus: RunBus;
	/** The transcript recorders of this computer's runs: `open(runId, stepId)` appends in its data folder. */
	recorders: Recorders;
	/** Where the run's steps run, as its plan says (`StepPlacement`). */
	placement: StepPlacement;
	now(): number;
	/** How long one minute of a timeout or a policy wait lasts. 60 000 in production. */
	minuteMs: number;
	settings(): WalkSettings;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
	/**
	 * The descriptor of a node's kind (`node-kinds.ts`). The registry comes
	 * in by the context, so the engine around the nodes never imports the
	 * node modules: they import it.
	 */
	kindOf(node: FlowNode): NodeKind;
	/**
	 * Takes a lease of the run's Space for the run (ADR 7): the engine's
	 * keeper, which asks this Replica's store or the Space's Host.
	 */
	leases: LeaseTaker;
	/** Starts and stops the services of Service nodes (ADR 9). */
	services: ServiceRunner;
	/** The files a run keeps for the person: an agent's artifacts, the files of the run's answers. */
	artifacts: Pick<ArtifactStore, "answerFiles" | "save">;
	/** The kept values a flow's run starts from, by name (`variables/`). */
	keptValues(flow: KeptFlow): Promise<Record<string, JsonValue>>;
	/** What a Since last run node remembers for one scope, by key (`memory/`). Empty: a first run. */
	remembered(at: MemoryAt): Promise<Map<string, Remembered>>;
	/**
	 * Keeps the shapes of a step's data on its node of `flow`, marked
	 * inferred, while the node has no output schema
	 * (`ProjectFlows.keepShapes`, `kept-shapes.ts`). Absent: nothing keeps
	 * them.
	 */
	keepShapes?(
		flow: KeptFlow,
		node: Pick<FlowNode, "id" | "type">,
		shapes: Record<string, Record<string, unknown>>,
	): Promise<void>;
	/**
	 * Keeps the types of a called flow's outputs on `flow`, marked
	 * inferred, while an output has no type (`ProjectFlows.keepOutputTypes`,
	 * `kept-shapes.ts`). Absent: nothing keeps them.
	 */
	keepOutputTypes?(flow: KeptFlow, types: readonly OutputType[]): Promise<void>;
	/** The git identity of a Person, for the worktree a Device adds; null when the repository keeps its own. */
	gitAuthor(personId: string): Promise<GitAuthor | null>;
};

/**
 * The type of one output of a called flow, from the value a run gave: what
 * the Walker keeps on that output, marked inferred (`keepOutputTypes`).
 * `value` is the output's template as the run read it: an output whose
 * template a person changed since gets no type from the old one.
 */
export type OutputType = {
	name: string;
	value: string;
	type: VariableType;
	schema?: Record<string, unknown>;
};

/**
 * What a node factory gets: what every step may touch (`StepShared`),
 * and the run's own. One per run and per compiled flow: a Call node
 * compiles its called flow with `flow` and `flowName` replaced (and
 * `placement`, for a Subflow that names a computer), everything else
 * shared. Per-invocation facts (the scope, the element's `run` template
 * fields) travel in `config.configurable`:
 *
 * - `configurable.scope: Scope | null`: the calling step and element, null
 *   at the top level. Body nodes stamp it on their events (design rule 6).
 * - `configurable.run?: { branch, base_branch, index }`: the `{{run.*}}`
 *   fields of a Call element (`each`); absent at the top level.
 */
export type StepContext = StepShared & {
	/** The run: id, project, worktree, branch, base ref, flow snapshots. */
	run: RunRow;
	/** The flow this graph was compiled from. */
	flow: Flow;
	/** `{{run.flow}}`: the flow's file name, or the run's title for a quick run. */
	flowName: string;
	/** The run's called flows by name (the bodies of Call nodes). */
	flows: Record<string, Flow>;
	/**
	 * The Call nodes from the run's flow to this graph's flow, outermost
	 * first: empty at the top level. A Since last run node remembers under
	 * it, so two Subflow nodes that call one flow keep their own memory.
	 */
	callPath: readonly string[];
	/**
	 * The run's policy, resolved at each use like `settings()`: a thread
	 * that stays compiled across a settings change (a run at a Gate for
	 * days, or asleep) plans its waits and checks the step cap with the
	 * current numbers, in bodies too.
	 */
	policy(): ResolvedPolicy;
	/** The run's abort signal: a person stopped the run. */
	signal(): AbortSignal;
	/**
	 * The race of the `first` Joins of this thread and the running steps of
	 * branches it may stop (`branches.ts`). A body shares its caller's.
	 */
	races: Races;
};

/**
 * Placement, as a step asks it (`StepContext.placement`): where a step
 * runs now, a Device of the run by id, and the move of a step whose
 * Device went offline. The engine's Placement module (`placement/`)
 * implements it over the run's plan; it decides nothing again.
 */
export type StepPlacement = {
	/**
	 * The Device a step of `node` runs on now, working for the run (its
	 * calls name the run, ADR 13): the one the plan says, or where the step
	 * moved to (`movedTo`: a step that goes on after a move, its session
	 * and its work are there). The step runner asks once per step and hands
	 * the Device to the body; no body touches a harness, a process, an MCP
	 * client or the decider itself.
	 */
	deviceFor(node: FlowNode, run: RunRow, movedTo?: string | null): Device;
	/** A Device of the run by id, working for the run: where its work is now (a Hand-off), the Device of a service. */
	deviceById(id: string, run: RunRow): Device;
	/**
	 * Moves a step whose Device is offline to the first of its fallbacks
	 * that can take it now (ADR 17), and logs `StepMoved` and the run's
	 * warning through `log`. The new Device, working for the run, or null
	 * when the step stays: it has a session to continue, or the run's work
	 * is only on its offline Device.
	 */
	moveStep(input: StepMove): Promise<Device | null>;
};

/** A step to move (`StepPlacement.moveStep`). */
export type StepMove = {
	/** The thread's log: the writes go through its fence. */
	log: Pick<RunLog, "append" | "state">;
	node: FlowNode;
	run: RunRow;
	stepId: string;
	/** The step's Device now, offline. */
	from: Device;
	/** The step has a harness session to continue: a session lives on its Device. */
	hasSession: boolean;
	/** The step works in the run's worktree: it stays with the run's work while the Device that has it is offline. */
	inWorktree: boolean;
};

/** How a Lease node takes its lease, and how a run lets go of one when it leaves its Section (`StepContext.leases`). */
export type LeaseTaker = {
	take(
		run: Pick<RunRow, "id" | "spaceId" | "title">,
		input: { name: string; ttlMinutes?: number },
	): Promise<LeaseAnswer>;
	/** Lets go of the run's leases of these names. */
	release(runId: string, names: readonly string[]): Promise<void>;
};

/**
 * How a Service node starts its service and waits until it is ready, and
 * how a run stops one (`StepContext.services`, ADR 9). The engine's
 * service keeper (`services/keeper.ts`) implements it.
 */
export type ServiceRunner = {
	bringUp(input: ServiceBringUp): Promise<ServiceBroughtUp>;
	/**
	 * Stops these services, each on its Device. Never throws: a stop that
	 * fails is logged, and the next service is still stopped.
	 */
	stop(runId: string, services: readonly StopService[]): Promise<void>;
	/** The last lines of a service's log ("" before it printed anything). */
	tail(logPath: string): string;
};

export type ServiceBringUp = {
	runId: string;
	nodeId: string;
	scope: Scope | null;
	/** The Device the service runs on. */
	device: Device;
	/** The Device is the computer that walks the run: a URL probe asks it from here. */
	here: boolean;
	cwd: string;
	spec: ServiceSpec;
	logPath: string;
	/** Aborts the wait for ready: a stop of the run. The service then stops. */
	signal: AbortSignal;
	/** The process runs, before the first probe: the caller logs it, so it is always stopped. */
	onStarted(started: {
		pid: number | null;
		startedAt: string | null;
	}): Promise<void>;
};

export type ServiceBroughtUp =
	/** `data`: what the ready command wrote to `$NS_OUTPUT`. */
	| { kind: "ready"; data?: JsonValue; logTail: string }
	/** The service stopped again (when it started at all). */
	| { kind: "failed"; reason: string; logTail: string }
	| { kind: "aborted"; logTail: string };

/** A service to stop, and the Device it runs on (null: that Device cannot be reached now). */
export type StopService = { service: ServiceHold; device: Device | null };

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
	// A body reads its caller's fields (`runBody`), `due_at` too: its own state has none.
	const fields = (config.configurable?.run as
		| { branch: string; base_branch: string; index: string; due_at?: string }
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
			due_at: fields.due_at ?? state.dueAt ?? "",
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
