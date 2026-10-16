import {
	type GraphInterrupt,
	isGraphInterrupt,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import type { Flow, FlowNode, NodeOutputs, Outcome } from "@nightshift/flows";

import {
	type DerivedStep,
	deriveNodeOutputs,
	deriveSteps,
	type InputValues,
	type LoggedEvent,
	type Scope,
	type StepOutputs,
	scopeKey,
} from "../../events";
import { flowOutputs } from "../../inputs";
import { compileFlow } from "../compile";
import type { StepContext, StepStart } from "../context";
import { isOwnAgentLabel } from "../route";
import type { Parked, RunStateValues } from "../state";

/**
 * What a Subflow and a For Each node share: running a called flow as a
 * subgraph of the node and reading how it ended (design rule 6).
 *
 * The body is compiled once per node (`bodyGraph`) and invoked with the
 * node's config passed through, so it checkpoints under the node's task
 * namespace and an interrupt inside it resumes inside it. The body's own
 * `StepContext` is the caller's with `flow` and `flowName` replaced.
 *
 * How a body ends, in the walk's terms (`ScopeEnd` in engine.ts):
 *
 * - `finished`: the body reached a chosen end (`state.ended`).
 * - `failed`: a body step ended `fail`/`needs-input` with no edge, errored,
 *   or exhausted its edge: the body parked at that step (rule 2). The park
 *   is swallowed here, because today a failed body fails the Subflow step
 *   (`fail`) or the element (`ItemEnded failed`) and the walk goes on; the
 *   body's namespace is left parked and is never invoked again (the next
 *   invoke of the node is a new task, so a new namespace).
 * - `stopped`: a person stopped the run, or the stop time or a stop after
 *   the step fired inside the body. The caller ends its step `stopped` and
 *   rethrows the interrupt, so the run parks; a resume lands back inside.
 * - `aborted`: the body parked `failed` before a step started (the step
 *   cap). The caller ends its step `error` and rethrows.
 * - `paused`: a wait or a Gate inside the body. The caller leaves its step
 *   open and rethrows.
 */

export type BodyRun = { branch: string; base_branch: string; index: string };

export type BodyEnd =
	| {
			kind: "finished";
			node: FlowNode;
			outcome: Outcome;
			/** The body's node outputs, from its final state. */
			nodes: NodeOutputs;
	  }
	| { kind: "failed"; reason: string }
	| { kind: "stopped"; reason: string | null; interrupt: GraphInterrupt }
	| { kind: "aborted"; reason: string; interrupt: GraphInterrupt }
	| { kind: "paused"; interrupt: GraphInterrupt };

export type BodyGraph = ReturnType<ReturnType<typeof compileFlow>["compile"]>;

/** The called flow compiled for the caller's run, with its own `flow` and `flowName`. */
export function bodyGraph(
	ctx: StepContext,
	called: Flow,
	flowName: string,
): BodyGraph {
	return compileFlow(called, { ...ctx, flow: called, flowName }).compile();
}

/**
 * Runs the body for the given inputs under the caller's config, with the
 * scope and the element's `run` fields in `configurable`.
 */
export async function runBody(input: {
	graph: BodyGraph;
	called: Flow;
	flowName: string;
	inputs: InputValues;
	config: LangGraphRunnableConfig;
	scope: Scope;
	run: BodyRun;
	/** The caller's stop time, as `stopAtOf` reads it: the body checks the same one. */
	stopAt: number | null;
}): Promise<BodyEnd> {
	const config: LangGraphRunnableConfig = {
		...input.config,
		configurable: {
			...input.config.configurable,
			scope: input.scope,
			run: input.run,
			stopAt: input.stopAt,
		},
	};
	let result: RunStateValues;
	try {
		result = (await input.graph.invoke(
			{ inputs: input.inputs },
			config,
		)) as RunStateValues;
	} catch (error) {
		if (!isGraphInterrupt(error)) throw error;
		const value = error.interrupts[0]?.value as Parked | undefined;
		if (value?.kind !== "parked") return { kind: "paused", interrupt: error };
		if (value.status === "stopped") {
			return { kind: "stopped", reason: value.reason, interrupt: error };
		}
		if (value.stepId === null) {
			return {
				kind: "aborted",
				reason: value.reason ?? "The run was aborted.",
				interrupt: error,
			};
		}
		return { kind: "failed", reason: value.reason ?? "unknown error" };
	}
	const ended = result.ended;
	if (!ended) {
		throw new Error(`The flow "${input.flowName}" ended without an outcome.`);
	}
	const node = input.called.nodes.find((n) => n.id === ended.nodeId);
	if (!node) {
		throw new Error(
			`The flow "${input.flowName}" has no node "${ended.nodeId}".`,
		);
	}
	return {
		kind: "finished",
		node,
		outcome: ended.outcome as Outcome,
		nodes: result.nodes,
	};
}

/**
 * The called flow's declared outputs, rendered in the body's own context:
 * from the node outputs of a finished body's state, or from the log for a
 * body that failed (its state was never returned).
 */
export async function bodyOutputs(
	ctx: StepContext,
	input: {
		called: Flow;
		flowName: string;
		inputs: InputValues;
		scope: Scope;
		run: BodyRun;
	},
	nodes?: NodeOutputs,
): Promise<StepOutputs> {
	return flowOutputs(input.called, {
		nodes:
			nodes ??
			deriveNodeOutputs(
				await ctx.log.events(ctx.run.id),
				scopeKey(input.scope),
			),
		inputs: input.inputs,
		run: {
			...input.run,
			worktree: ctx.run.worktreePath,
			base_ref: ctx.run.baseRef,
			flow: input.flowName,
		},
	});
}

/** A Subflow's `ended`: the Decision option or Agent outcome its flow ended on, or "". */
export function endedLabel(node: FlowNode, outcome: Outcome): string {
	return node.type === "decision" || isOwnAgentLabel(node, outcome)
		? outcome
		: "";
}

/**
 * How a Subflow or For Each node enters an existing step of its own: it
 * continues an open one (nothing appended) and reopens an ended one
 * (`StepReopened` with no prompt), exactly `openCallStep`'s rule for a
 * `call` start.
 */
export function continueStep(existing: DerivedStep | null): StepStart {
	if (!existing) return { kind: "new" };
	if (existing.endedAt !== null) {
		return { kind: "reopen", stepId: existing.id, prompt: null };
	}
	return { kind: "continue", stepId: existing.id };
}

/** The latest step of the node in this scope, as the log has it. */
export function latestStepOf(
	node: FlowNode,
	events: readonly LoggedEvent[],
	scope: Scope | null,
): DerivedStep | null {
	const key = scopeKey(scope);
	return (
		deriveSteps(events).findLast(
			(s) => s.nodeId === node.id && scopeKey(s.scope) === key,
		) ?? null
	);
}
