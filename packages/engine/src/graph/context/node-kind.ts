import type { Command, LangGraphRunnableConfig } from "@langchain/langgraph";
import type { FlowNode, Outcome, ResolvedPolicy } from "@nightshift/flows";
import type { Capabilities } from "../../device";
import type { DerivedStep, StepOutputs } from "../../log";
import type { RunResult } from "../../run-status";
import type { RunStateValues } from "../state";
import type { StepContext } from "./context";

/**
 * What every node module gives back: `NodeKind`, the descriptor the
 * registry in `nodes/node-kinds.ts` lists, with the graph node it makes
 * (`NodeAction`, `NodeFactory`), the facts most kinds share (`PLAIN_KIND`)
 * and which existing step a kind takes up again (`ResumeRules`). It sits
 * with `StepContext`: a node factory takes the context, and the context
 * gives the descriptor of a node (`StepShared.kindOf`).
 */

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
	 * The `RunEnded` reason of a chosen end: null for the flow's plain end,
	 * else which node and outcome, or what the node says (`outputs`, the
	 * step's outputs: an End node's message).
	 */
	endSentence(node: N, outcome: Outcome, outputs: StepOutputs): string | null;
	/**
	 * The result a chosen end gives the run (`RunEnded.result`): an End
	 * node's status. Null for every other end.
	 */
	endResult(node: N, outcome: Outcome): RunResult | null;
	/**
	 * The report of a chosen end (`outputs`, the step's outputs): an End
	 * node's report, which a Call gives as `end_report`. Null for every
	 * other end, and for an End without one.
	 */
	endReport(node: N, outputs: StepOutputs): string | null;
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
	/**
	 * Whether a step that works in the run's worktree goes to the Device
	 * that has the run's work now, instead of a Hand-off to its own Device
	 * (`beginStep`): it only reads there (an End's report file). A run
	 * folder does not move, so there the step stays on its own Device.
	 */
	followsWork(node: N): boolean;
};

/** The outcome of a step whose work was cut short: stopped, overdue (`error`), or interrupted. */
export type CutShortOutcome = "stopped" | "error" | "interrupted";

/** The `RunEnded` reason of a chosen end that is not the flow's plain end. */
export function endedAtReason(node: FlowNode, outcome: Outcome): string {
	return `Ended at node "${node.id}" with "${outcome}".`;
}

/**
 * The facts most kinds share, for a kind to spread and override: no
 * auxiliary node, `pass` is the plain end, no report for a Call, no
 * command log, the node's own `timeoutMinutes`, a
 * cut-short step keeps its outputs, no connections, no programs, no
 * requirements, no computer, and a step that works in the worktree gets
 * the run's work by a Hand-off.
 */
export const PLAIN_KIND = {
	aux: () => [],
	endSentence: (node, outcome) =>
		outcome === "pass" ? null : endedAtReason(node, outcome),
	endResult: () => null,
	endReport: () => null,
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
	followsWork: () => false,
} satisfies Omit<NodeKind, "type" | "make" | "resumeRules">;

/**
 * The per-kind flags: which existing step a node kind takes up again. These
 * are the only genuine differences between the node kinds.
 */
export type ResumeRules = {
	/**
	 * A step a person resumed after it parked the run (`pending.kind ===
	 * "parked"`). `new`: the node has nothing to continue (a Call once, a
	 * Decision, a Wait). `with-session`: only a step with a harness session,
	 * which the session continues with the resume prompt (an Agent).
	 * `cut-short`: only a step that ended `stopped`, `error` or
	 * `interrupted`, so the work goes on where it stopped; an exhausted loop
	 * (`done`, `halted` with no edge) starts over (a Call with `each`).
	 */
	parked: "new" | "with-session" | "cut-short";
	/**
	 * The step the log has that the checkpoint never saw (the daemon died
	 * while it ran). `new`: a new visit, the recovered step stays ended
	 * (a Decision by a model, a Wait). `take-up`: continue it open, reopen it
	 * ended (a Call: its body resumes under the same namespace).
	 * `with-session`: reopened when it has a harness session, open or ended
	 * (an Agent: the harness process is gone, so the session is invoked
	 * again with a prompt). `asked-gate`: continued only while it is open
	 * with its Gate asked (`GateOpened` after its latest opening): the crash
	 * window between `GateOpened` and the checkpoint commit must not open a
	 * second Gate. A Gate step that ended is not reused.
	 */
	crashed: "new" | "take-up" | "with-session" | "asked-gate";
	/** The node loops over elements: mid-loop its latest step continues. */
	loop?: boolean;
};
