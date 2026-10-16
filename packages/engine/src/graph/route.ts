import {
	Command,
	END,
	interrupt,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { type FlowNode, nextEdge, type Outcome } from "@nightshift/flows";

import type { Scope, StepOutputs } from "../events";
import type { StepOutcome } from "../types";
import type { StepContext } from "./context";
import type {
	Parked,
	PendingParked,
	ResumeValue,
	RunStateUpdate,
	RunStateValues,
} from "./state";

/**
 * Where a node goes after its step: the edge the outcome picks, a chosen
 * end, or the node's park node. Ported from `walkScope` in engine.ts.
 *
 * Node naming in the compiled graph: the step node is the flow node's id;
 * its park node is `park__<id>`; the wait node of an Agent node or a
 * Decision decided by a model is `wait__<id>`.
 */

export const parkNodeId = (nodeId: string) => `park__${nodeId}`;
export const waitNodeId = (nodeId: string) => `wait__${nodeId}`;

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
};

/** An Agent's own outcome, other than one named `fail` or `needs-input`. */
export function isOwnAgentLabel(node: FlowNode, outcome: Outcome): boolean {
	return (
		node.type === "agent" &&
		node.outcomes !== undefined &&
		outcome !== "fail" &&
		outcome !== "needs-input"
	);
}

/**
 * Whether ending at `node` with `outcome` and no edge to take is a chosen
 * end of the flow: `pass`, a Decision option, an Agent's own outcome, or a
 * For Each outcome. `fail` and `needs-input` are failures.
 */
export function isChosenEnd(node: FlowNode, outcome: Outcome): boolean {
	return (
		outcome === "pass" ||
		node.type === "decision" ||
		node.type === "foreach" ||
		isOwnAgentLabel(node, outcome)
	);
}

/** The `RunEnded` reason of a chosen end: null for the flow's plain end, else which node and outcome. */
export function finishedReason(
	node: FlowNode,
	outcome: Outcome,
): string | null {
	const chosen =
		(outcome === "pass" && node.type !== "foreach") ||
		(outcome === "done" && node.type === "foreach");
	return chosen ? null : `Ended at node "${node.id}" with "${outcome}".`;
}

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
	};
	return new Command({
		update: { ...input.update, pending },
		goto: parkNodeId(node.id),
	});
}

/**
 * Records the ended step's outputs and visit in the state and jumps along
 * the edge the outcome picks, with `EdgeTaken` in the log; or ends the flow
 * on a chosen end; or parks the run. Exactly `walkScope`'s rules:
 *
 * - `stopped` parks as stopped with no reason.
 * - `error` and `interrupted` park as failed: `Node "x" failed: <error>`.
 * - no edge: `fail` and `needs-input` park as failed; `pass`, a Decision
 *   option, an Agent's own outcome or a For Each outcome is a chosen end
 *   (`ended` set, goto END).
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
		visits: { [node.id]: visit },
		pending: null,
	};
	const park = (status: "failed" | "stopped", reason: string | null) =>
		parkCommand({ node, status, reason, step: end, update });
	if (outcome === "stopped") return park("stopped", null);
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
		if (isChosenEnd(node, outcome)) {
			return new Command({
				update: {
					...update,
					ended: {
						status: "finished",
						nodeId: node.id,
						outcome,
						reason: finishedReason(node, outcome),
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
 * The park node of every flow node. It interrupts with the parked step
 * (the runner appends `RunEnded`), after nothing else (design rule 4). A
 * resume jumps back to the node with `pending.prompt` set; the node reopens
 * the parked step when it can, else starts a new visit.
 */
export function parkNode(node: FlowNode) {
	return async (state: RunStateValues): Promise<Command> => {
		const pending = state.pending;
		if (pending?.kind !== "parked" || pending.nodeId !== node.id) {
			throw new Error(`Nothing is parked at node "${node.id}".`);
		}
		const value: Parked = {
			kind: "parked",
			stepId: pending.stepId,
			nodeId: node.id,
			status: pending.status,
			reason: pending.reason,
		};
		const answer = interrupt<Parked, ResumeValue | undefined>(value);
		const prompt =
			answer && "prompt" in answer && answer.prompt !== undefined
				? answer.prompt
				: null;
		return new Command({
			update: { pending: { ...pending, prompt } },
			goto: node.id,
		});
	};
}
