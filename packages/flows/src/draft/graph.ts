/** Edits of the flow graph: nodes, edges, the start, inputs, outputs, variables and the run policy. */
import type {
	Flow,
	FlowEdge,
	FlowInputDef,
	FlowNode,
	FlowNodeType,
	FlowOutputDef,
	FlowVariableDef,
	Outcome,
	Policy,
} from "../document";
import type { ProjectFlowMap } from "../validate";
import { uniqueEdgeId, uniqueNodeId } from "./names";
import {
	agentNode,
	callNode,
	commandNode,
	decisionNode,
	type NodeDefaults,
	type Position,
	toolNode,
	valueNode,
	waitNode,
} from "./nodes";
import { renameRefs, rewriteFlowTemplates } from "./refs";
import { sectionsWithoutNode, sectionsWithRenamedNode } from "./sections";

/**
 * Sets one value of the run policy, or clears it (back to the daemon's
 * setting). A policy with no values left is dropped, so the file stays
 * minimal.
 */
export function setPolicyValue<K extends keyof Policy>(
	flow: Flow,
	key: K,
	value: Policy[K] | undefined,
): Flow {
	const next: Partial<Policy> = { ...flow.policy, [key]: value };
	if (value === undefined) delete next[key];
	const empty = Object.keys(next).length === 0;
	return { ...flow, policy: empty ? undefined : next };
}

/** Replaces the flow's inputs. */
export function setInputs(flow: Flow, inputs: FlowInputDef[]): Flow {
	return { ...flow, inputs };
}

/** Replaces the flow's outputs. */
export function setOutputs(flow: Flow, outputs: FlowOutputDef[]): Flow {
	return { ...flow, outputs };
}

/** Replaces the flow's variables. None: the file has no `variables` at all. */
export function setVariables(flow: Flow, variables: FlowVariableDef[]): Flow {
	const { variables: _, ...rest } = flow;
	return variables.length > 0 ? { ...rest, variables } : rest;
}

const NEW_NODE: Record<
	FlowNodeType,
	{
		id: string;
		create: (
			id: string,
			position: Position,
			defaults: NodeDefaults,
		) => FlowNode;
	}
> = {
	agent: { id: "agent", create: agentNode },
	command: { id: "check", create: commandNode },
	decision: { id: "decide", create: decisionNode },
	call: { id: "call", create: callNode },
	value: { id: "value", create: valueNode },
	wait: { id: "wait", create: waitNode },
	tool: { id: "tool", create: toolNode },
};

/** Adds a node of `type`; a new Agent node starts with `defaults`. */
export function addNode(
	flow: Flow,
	type: FlowNodeType,
	position: Position,
	defaults: NodeDefaults = {},
) {
	const id = uniqueNodeId(flow, NEW_NODE[type].id);
	const node = NEW_NODE[type].create(id, position, defaults);
	const next: Flow = {
		...flow,
		nodes: [...flow.nodes, node],
		// A flow without nodes has no valid start; the first node becomes it.
		start: flow.nodes.length === 0 ? id : flow.start,
	};
	return { flow: next, id };
}

export function updateNode(
	flow: Flow,
	id: string,
	change: (node: FlowNode) => FlowNode,
): Flow {
	return {
		...flow,
		nodes: flow.nodes.map((node) => (node.id === id ? change(node) : node)),
	};
}

export function moveNode(flow: Flow, id: string, position: Position): Flow {
	return updateNode(flow, id, (node) => ({
		...node,
		position: { x: Math.round(position.x), y: Math.round(position.y) },
	}));
}

/**
 * Removes the node and its edges, and takes it out of its Section. A
 * removed start node hands start to the first node left.
 */
export function removeNode(flow: Flow, id: string): Flow {
	const nodes = flow.nodes.filter((node) => node.id !== id);
	return sectionsWithoutNode(
		{
			...flow,
			nodes,
			edges: flow.edges.filter((edge) => edge.from !== id && edge.to !== id),
			start: flow.start === id ? (nodes[0]?.id ?? "") : flow.start,
		},
		id,
	);
}

/**
 * Renames a node everywhere: its edges, the start, its Section, and
 * `{{old…}}` references in the flow's templates and outputs.
 */
export function renameNode(flow: Flow, from: string, to: string): Flow {
	if (from === to) return flow;
	const renamed = rewriteFlowTemplates(
		{
			...flow,
			nodes: flow.nodes.map((node) =>
				node.id === from ? { ...node, id: to } : node,
			),
		},
		(text) => renameRefs(text, from, to),
	);
	return sectionsWithRenamedNode(
		{
			...renamed,
			start: flow.start === from ? to : flow.start,
			edges: flow.edges.map((edge) => ({
				...edge,
				from: edge.from === from ? to : edge.from,
				to: edge.to === from ? to : edge.to,
			})),
		},
		from,
		to,
	);
}

export function addEdge(
	flow: Flow,
	from: string,
	outcome: Outcome,
	to: string,
): { flow: Flow; id: string } | null {
	const exists = flow.edges.some(
		(edge) => edge.from === from && edge.outcome === outcome && edge.to === to,
	);
	if (exists) return null;
	const id = uniqueEdgeId(flow, `${from}-${outcome}-${to}`);
	return {
		flow: { ...flow, edges: [...flow.edges, { id, from, outcome, to }] },
		id,
	};
}

export function updateEdge(
	flow: Flow,
	id: string,
	change: (edge: FlowEdge) => FlowEdge,
): Flow {
	return {
		...flow,
		edges: flow.edges.map((edge) => (edge.id === id ? change(edge) : edge)),
	};
}

export function removeEdge(flow: Flow, id: string): Flow {
	return { ...flow, edges: flow.edges.filter((edge) => edge.id !== id) };
}

/** The flows of the project that call `name` through a Call node. */
export function callersOf(name: string, flows: ProjectFlowMap): string[] {
	return Object.entries(flows)
		.filter(
			([caller, flow]) =>
				caller !== name &&
				(flow?.nodes ?? []).some(
					(node) => node.type === "call" && node.flow === name,
				),
		)
		.map(([caller]) => caller)
		.sort();
}

/** Whether the edge closes a loop: its source is reachable again from its target. */
export function edgeInLoop(flow: Flow, edge: FlowEdge): boolean {
	const seen = new Set<string>();
	const queue = [edge.to];
	while (queue.length > 0) {
		const id = queue.shift() as string;
		if (id === edge.from) return true;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const next of flow.edges) if (next.from === id) queue.push(next.to);
	}
	return false;
}
