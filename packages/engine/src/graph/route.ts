import {
	Command,
	END,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { type FlowNode, type JsonValue, nextEdge } from "@nightshift/flows";
import type { Scope, StepOutcome, StepOutputs } from "../log";
import type { NodeAction, StepContext } from "./context";
import { interruptNode } from "./interrupt";
import { commitVisit } from "./run-position";
import type { PendingParked, RunStateUpdate, RunStateValues } from "./state";

/**
 * Where a node goes after its step: the edge the outcome picks, a chosen
 * end, or the node's park node. Ported from `walkScope` in engine.ts. Which
 * ends are chosen and what `RunEnded` says are the node kind's facts
 * (`ctx.kindOf(node).isChosenEnd`, `endReason`): this module switches on no
 * node type.
 *
 * Node naming in the compiled graph: the step node is the flow node's id;
 * its park node is `park__<id>`; the wait node of an Agent node or a
 * Decision decided by a model is `wait__<id>`; the ask node of a Decision
 * decided by a person (a Gate) is `ask__<id>`.
 */

export const parkNodeId = (nodeId: string) => `park__${nodeId}`;
export const waitNodeId = (nodeId: string) => `wait__${nodeId}`;
export const askNodeId = (nodeId: string) => `ask__${nodeId}`;

/** The scope of the flow this graph runs in: null at the top level. */
export function scopeOf(config: LangGraphRunnableConfig): Scope | null {
	return (config.configurable?.scope as Scope | null | undefined) ?? null;
}

/** How a step ended: what `StepEnded` recorded, plus what a park needs to continue it. */
export type StepEnd = {
	stepId: string;
	visit: number;
	outcome: StepOutcome;
	outputs: StepOutputs;
	error: string | null;
	/** Agent steps: the harness session the step has, for a reopen. */
	harnessSessionId?: string | null;
	/** The variables the step's writes changed (`StepEnded.variables`). */
	variables?: Record<string, JsonValue>;
};

/**
 * Parks the run at the node's park node (design rule 2): `pending` keeps
 * the step so a resume reopens it, and the park node interrupts with the
 * status and reason `RunEnded` records. `step` is null when the run parks
 * before the node's step started (stop after step, stop time, step cap).
 */
export function parkCommand(input: {
	node: FlowNode;
	status: "failed" | "stopped";
	reason: string | null;
	step: StepEnd | null;
	update?: RunStateUpdate;
	/** The stop time stopped the run (`PendingParked.atStopTime`). */
	atStopTime?: boolean;
}): Command {
	const { node, step } = input;
	const pending: PendingParked = {
		kind: "parked",
		stepId: step?.stepId ?? null,
		nodeId: node.id,
		visit: step?.visit ?? 0,
		harnessSessionId: step?.harnessSessionId ?? null,
		prompt: null,
		status: input.status,
		reason: input.reason,
		...(input.atStopTime ? { atStopTime: true } : {}),
	};
	return new Command({
		update: { ...input.update, pending },
		goto: parkNodeId(node.id),
	});
}

/**
 * Parks the run as stopped on a step that ended `stopped`, with the step's
 * outputs and visit in the state: the stop time came while it was open.
 */
export function parkStopped(
	node: FlowNode,
	end: StepEnd,
	reason: string,
	update?: RunStateUpdate,
): Command {
	return parkCommand({
		node,
		status: "stopped",
		reason,
		step: end,
		atStopTime: true,
		update: {
			...update,
			nodes: { [node.id]: end.outputs },
			...commitVisit(node, end.visit),
		},
	});
}

/**
 * Records the ended step's outputs in the state, commits its visit
 * (`commitVisit`) and jumps along
 * the edge the outcome picks, with `EdgeTaken` in the log; or ends the flow
 * on a chosen end; or parks the run. Exactly `walkScope`'s rules:
 *
 * - `stopped` parks as stopped with no reason, except a step that ends
 *   `stopped` with `wrappingUp` in `extra` (a Call node the stop time
 *   ended, with a `stopped` edge): it takes the edge.
 * - `error` and `interrupted` park as failed: `Node "x" failed: <error>`.
 * - no edge: a chosen end of the kind (`pass`, a Decision option, an
 *   Agent's own outcome, a Command's exit on code 0, a Wait's `done`, the
 *   outcome of a Call with `each`) ends the flow (`ended` set, goto END);
 *   `fail`, `needs-input` and the rest park as failed.
 * - every edge on the outcome at its max parks as failed.
 */
export async function route(
	ctx: StepContext,
	state: RunStateValues,
	node: FlowNode,
	end: StepEnd,
	config: LangGraphRunnableConfig,
	extra?: RunStateUpdate,
): Promise<Command> {
	const { outcome, visit } = end;
	const update: RunStateUpdate = {
		...extra,
		nodes: { [node.id]: end.outputs },
		...(end.variables ? { vars: end.variables } : {}),
		...commitVisit(node, visit),
		pending: null,
	};
	const park = (status: "failed" | "stopped", reason: string | null) =>
		parkCommand({ node, status, reason, step: end, update });
	// A stop parks. The one exception: a Call node the stop time ended
	// follows its `stopped` edge to the nodes that wrap the run up. Only a
	// Call node passes `wrappingUp` (`hasStoppedEdge` in nodes/body.ts).
	if (outcome === "stopped" && !extra?.wrappingUp) {
		return park("stopped", null);
	}
	if (outcome === "error" || outcome === "interrupted") {
		return park(
			"failed",
			`Node "${node.id}" failed: ${end.error ?? "unknown error"}`,
		);
	}
	const choice = nextEdge({
		flow: ctx.flow,
		from: node.id,
		outcome,
		traversals: state.traversals,
	});
	if (choice.kind === "end") {
		const kind = ctx.kindOf(node);
		if (kind.isChosenEnd(node, outcome)) {
			return new Command({
				update: {
					...update,
					ended: {
						status: "finished",
						nodeId: node.id,
						outcome,
						reason: kind.endReason(node, outcome),
					},
				},
				goto: END,
			});
		}
		return park(
			"failed",
			`Node "${node.id}" ended with "${outcome}" and no edge leaves it on that outcome.`,
		);
	}
	if (choice.kind === "exhausted") {
		const edges = choice.edges
			.map(
				(e) =>
					`"${e.id}" (${e.from} → ${e.to} on ${e.outcome}, max ${e.max ?? "∞"})`,
			)
			.join(", ");
		return park(
			"failed",
			`Node "${node.id}" ended with "${outcome}", but edge ${edges} reached its max.`,
		);
	}
	const { edge } = choice;
	await ctx.log.append({
		type: "EdgeTaken",
		runId: ctx.run.id,
		payload: {
			edgeId: edge.id,
			from: edge.from,
			to: edge.to,
			outcome,
			scope: scopeOf(config),
		},
	});
	return new Command({
		update: {
			...update,
			traversals: { [edge.id]: (state.traversals[edge.id] ?? 0) + 1 },
		},
		goto: edge.to,
	});
}

/**
 * The park node of every flow node (`interruptNode`). It interrupts with the
 * parked step (the runner appends `RunEnded`), after nothing else (design
 * rule 4). A resume jumps back to the node with `pending.prompt` set; the
 * node reopens the parked step when it can, else starts a new visit.
 */
export function parkNode(node: FlowNode): NodeAction {
	return interruptNode({
		kind: "parked",
		nodeId: node.id,
		missing: `Nothing is parked at node "${node.id}".`,
		value: (pending) => ({
			kind: "parked",
			stepId: pending.stepId,
			nodeId: node.id,
			status: pending.status,
			reason: pending.reason,
			...(pending.atStopTime ? { atStopTime: true } : {}),
		}),
		answer: (pending, answer) => {
			const prompt =
				answer && "prompt" in answer && answer.prompt !== undefined
					? answer.prompt
					: null;
			return new Command({
				update: { pending: { ...pending, prompt } },
				goto: node.id,
			});
		},
	});
}
