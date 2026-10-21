/** The options, outcomes and exits of a node, and the edges that leave on them. */

import {
	type Flow,
	type FlowEdge,
	type FlowNode,
	nodeOutcomes,
	type Outcome,
} from "../document";
import {
	type AgentNode,
	type CallEach,
	type CallNode,
	type CommandNode,
	commandExits,
	type DecisionNode,
} from "../nodes";
import { updateNode } from "./graph";

/** A Decision option or an Agent's own outcome. Each one is an outcome of its node. */
/** A Decision option, an Agent outcome, or a Command exit (with its `code`). */
export type NodeOption = DecisionNode["options"][number] & { code?: number };
/** A node whose outcomes are its own options. */
export type OptionNode = DecisionNode | AgentNode | CommandNode;

export function isOptionNode(node: FlowNode): node is OptionNode {
	return (
		node.type === "decision" || node.type === "agent" || node.type === "command"
	);
}

/** The options of a Decision node, an Agent's own outcomes, or a Command's exits. */
export function nodeOptions(node: OptionNode): NodeOption[] {
	if (node.type === "decision") return node.options;
	if (node.type === "command") return commandExits(node);
	return node.outcomes ?? [];
}

export function withOptions<T extends OptionNode>(
	node: T,
	options: NodeOption[],
): T {
	if (node.type === "decision") return { ...node, options };
	if (node.type === "command") {
		const exits = options.map(({ name, code, description, color }) => ({
			name,
			...(code === undefined ? {} : { code }),
			...(description === undefined ? {} : { description }),
			...(color === undefined ? {} : { color }),
		}));
		return { ...node, exits };
	}
	return { ...node, outcomes: options };
}

function changeOptions(
	flow: Flow,
	nodeId: string,
	change: (options: NodeOption[]) => NodeOption[],
): Flow {
	return updateNode(flow, nodeId, (node) =>
		isOptionNode(node) ? withOptions(node, change(nodeOptions(node))) : node,
	);
}

/**
 * Renames a Decision label, a Gate choice or an Agent's own outcome, and
 * moves the node's edges on that outcome along with it.
 */
export function renameOutcome(
	flow: Flow,
	nodeId: string,
	index: number,
	to: Outcome,
): Flow {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node || !isOptionNode(node)) return flow;
	const from = nodeOptions(node)[index]?.name;
	if (from === undefined || from === to) return flow;
	const next = changeOptions(flow, nodeId, (options) =>
		options.map((option, at) =>
			at === index ? { ...option, name: to } : option,
		),
	);
	return {
		...next,
		edges: next.edges.map((edge) =>
			edge.from === nodeId && edge.outcome === from
				? { ...edge, outcome: to }
				: edge,
		),
	};
}

/**
 * Removes a Decision label, a Gate choice or an Agent's own outcome, and the
 * node's edges on it (unless another option keeps the same name). Returns
 * what it removed, for an undo.
 */
export function removeOutcome(
	flow: Flow,
	nodeId: string,
	index: number,
): { flow: Flow; option: NodeOption | null; dropped: FlowEdge[] } {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node || !isOptionNode(node)) {
		return { flow, option: null, dropped: [] };
	}
	const options = nodeOptions(node);
	const option = options[index];
	if (!option) return { flow, option: null, dropped: [] };
	const stillThere = options.some(
		(other, at) => at !== index && other.name === option.name,
	);
	const dropped = stillThere
		? []
		: flow.edges.filter(
				(edge) => edge.from === nodeId && edge.outcome === option.name,
			);
	const next = changeOptions(flow, nodeId, (list) =>
		list.filter((_, at) => at !== index),
	);
	return {
		flow: {
			...next,
			edges: next.edges.filter((edge) => !dropped.includes(edge)),
		},
		option,
		dropped,
	};
}

/** Puts dropped edges back whose nodes still exist and whose ids are free. */
function restoreEdges(flow: Flow, dropped: FlowEdge[]): Flow {
	const ids = new Set(flow.nodes.map((candidate) => candidate.id));
	const edgeIds = new Set(flow.edges.map((edge) => edge.id));
	const back = dropped.filter(
		(edge) => ids.has(edge.from) && ids.has(edge.to) && !edgeIds.has(edge.id),
	);
	return { ...flow, edges: [...flow.edges, ...back] };
}

/**
 * Undoes `removeOutcome`: puts the option back at its place and the dropped
 * edges whose nodes still exist. Does nothing when the node is gone or the
 * name is taken again.
 */
export function restoreOutcome(
	flow: Flow,
	nodeId: string,
	index: number,
	option: NodeOption,
	dropped: FlowEdge[],
): Flow {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node || !isOptionNode(node)) return flow;
	if (nodeOptions(node).some((other) => other.name === option.name)) {
		return flow;
	}
	const next = changeOptions(flow, nodeId, (options) => [
		...options.slice(0, index),
		option,
		...options.slice(index),
	]);
	return restoreEdges(next, dropped);
}

/**
 * Gives an Agent node its own outcomes, or (undefined) back the standard
 * pass, fail and needs-input. Edges on an outcome the node no longer has are
 * dropped and returned, for an undo.
 */
export function setAgentOutcomes(
	flow: Flow,
	nodeId: string,
	outcomes: NodeOption[] | undefined,
): { flow: Flow; dropped: FlowEdge[]; previous: NodeOption[] | undefined } {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (node?.type !== "agent") return { flow, dropped: [], previous: undefined };
	const { outcomes: previous, ...rest } = node;
	const changed: AgentNode = outcomes ? { ...rest, outcomes } : rest;
	const kept = new Set(nodeOutcomes(changed));
	const dropped = flow.edges.filter(
		(edge) => edge.from === nodeId && !kept.has(edge.outcome),
	);
	const next = updateNode(flow, nodeId, () => changed);
	return {
		flow: {
			...next,
			edges: next.edges.filter((edge) => !dropped.includes(edge)),
		},
		dropped,
		previous,
	};
}

/** Undoes `setAgentOutcomes`. */
export function restoreAgentOutcomes(
	flow: Flow,
	nodeId: string,
	previous: NodeOption[] | undefined,
	dropped: FlowEdge[],
): Flow {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (node?.type !== "agent") return flow;
	const { outcomes: _, ...rest } = node;
	const next = updateNode(flow, nodeId, () =>
		previous ? { ...rest, outcomes: previous } : rest,
	);
	return restoreEdges(next, dropped);
}

/**
 * Makes a Call node run once per item (`each`, the defaults or what it had
 * before) or once (no `each`). Its outcomes change with it (pass and fail,
 * or done and halted; stopped stays), so edges on an outcome the node no longer has are
 * dropped and returned, for an undo.
 */
export function setCallEach(
	flow: Flow,
	nodeId: string,
	each: CallEach | undefined,
): { flow: Flow; dropped: FlowEdge[]; previous: CallEach | undefined } {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (node?.type !== "call") return { flow, dropped: [], previous: undefined };
	const { each: previous, ...rest } = node;
	const changed: CallNode = each ? { ...rest, each } : rest;
	const kept = new Set(nodeOutcomes(changed));
	const dropped = flow.edges.filter(
		(edge) => edge.from === nodeId && !kept.has(edge.outcome),
	);
	const next = updateNode(flow, nodeId, () => changed);
	return {
		flow: {
			...next,
			edges: next.edges.filter((edge) => !dropped.includes(edge)),
		},
		dropped,
		previous,
	};
}

/** Undoes `setCallEach`. */
export function restoreCallEach(
	flow: Flow,
	nodeId: string,
	previous: CallEach | undefined,
	dropped: FlowEdge[],
): Flow {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (node?.type !== "call") return flow;
	const { each: _, ...rest } = node;
	const next = updateNode(flow, nodeId, () =>
		previous ? { ...rest, each: previous } : rest,
	);
	return restoreEdges(next, dropped);
}

/** `base`, else `base-2`, `base-3`, … whichever the node does not use yet. */
export function uniqueOptionName(options: NodeOption[], base: string): string {
	const taken = new Set(options.map((option) => option.name));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base}-${n}`;
		if (!taken.has(name)) return name;
	}
}
