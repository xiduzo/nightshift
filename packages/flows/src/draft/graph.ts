/** Edits of the flow graph: nodes, edges, the start, inputs, outputs, variables and the run policy. */
import {
	definitionOf,
	type Flow,
	type FlowEdge,
	type FlowInputDef,
	type FlowNode,
	type FlowNodeType,
	type FlowOutputDef,
	type FlowVariableDef,
	NODE_DEFINITIONS,
	nodeOutcomes,
	type Outcome,
	type Policy,
} from "../flow";
import type { NewNode, NodeDefaults, Position } from "../nodes";
import { jsonataPath } from "../presets";
import { mainOutputField, outputFieldShape } from "../shapes";
import { takenNames, uniqueEdgeId, uniqueNodeId } from "./names";
import { renameInFlow } from "./refs";
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

/**
 * What the palette adds: a node of a type, or a Decision by who decides it
 * (`NodeDefinition.newNodes`). A Gate is a Decision you decide, a Branch
 * one a rule decides.
 */
export type NewNodeKind = {
	[T in FlowNodeType]: keyof (typeof NODE_DEFINITIONS)[T]["newNodes"];
}[FlowNodeType];

/** Every kind of the palette, with its new node. */
const NEW_NODE = Object.fromEntries(
	Object.values(NODE_DEFINITIONS).flatMap((definition) =>
		Object.entries(definition.newNodes),
	),
) as Record<NewNodeKind, NewNode<FlowNode>>;

/** Adds a node of `type`; a new Agent node starts with `defaults`. */
export function addNode(
	flow: Flow,
	type: NewNodeKind,
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

/** The longest node id (`nodeIdSchema`). */
const MAX_NODE_ID = 40;

/**
 * Adds a Subflow node that runs `flowName`: a flow of the project or a kit.
 * Its id comes from the name, `publish_draft_pr` for
 * `kit:github/publish-draft-pr`, with `_2`, `_3`, … when it is taken.
 */
export function addCalledNode(
	flow: Flow,
	flowName: string,
	position: Position,
): { flow: Flow; id: string } {
	const id = calledNodeId(flow, flowName);
	const node = { ...NEW_NODE.call.create(id, position, {}), flow: flowName };
	const next: Flow = {
		...flow,
		nodes: [...flow.nodes, node],
		start: flow.nodes.length === 0 ? id : flow.start,
	};
	return { flow: next, id };
}

/** A free node id from the last part of a flow's name: `kit:feeds/read` gives `read`. */
function calledNodeId(flow: Flow, flowName: string): string {
	const last = flowName.slice(flowName.lastIndexOf("/") + 1);
	const words = last
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	const named = words === "" ? "call" : words;
	const base = /^[a-z]/.test(named) ? named : `flow_${named}`;
	const trim = (text: string, max: number) =>
		text.slice(0, max).replace(/_+$/, "");
	const taken = takenNames(flow);
	let id = trim(base, MAX_NODE_ID);
	for (let n = 2; taken.has(id); n++) {
		const suffix = `_${n}`;
		id = `${trim(base, MAX_NODE_ID - suffix.length)}${suffix}`;
	}
	return id;
}

/**
 * Whether a new node of each kind starts from nothing or takes a value:
 * the main output of the node before it (`mainOutputField`). A Branch
 * tests it, a Value shapes it, Since last run compares it, and Convert
 * converts it.
 */
export const NEW_NODE_TAKES = Object.fromEntries(
	Object.entries(NEW_NODE).map(([kind, node]) => [kind, node.takes]),
) as Record<NewNodeKind, NewNode<FlowNode>["takes"]>;

/**
 * Adds a node of `kind` after node `fromId`. A kind that takes a value
 * (`NEW_NODE_TAKES`) reads the main output of `fromId`: a Convert converts
 * it, a Since last run compares it (the one list in it, if it holds one),
 * and a Value or a Branch reads it in its rule. An edge leads from the
 * first outcome of `fromId`, but only when no edge leaves on that outcome
 * yet. Without a node `fromId`, it adds the node as `addNode` does.
 */
export function addNodeAfter(
	flow: Flow,
	kind: NewNodeKind,
	fromId: string,
	position: Position,
	defaults: NodeDefaults = {},
): { flow: Flow; id: string } {
	const added = addNode(flow, kind, position, defaults);
	const from = flow.nodes.find((node) => node.id === fromId);
	if (!from) return added;
	let next = updateNode(added.flow, added.id, (node) =>
		readingFrom(node, from),
	);
	const outcome = nodeOutcomes(from)[0];
	const taken = next.edges.some(
		(edge) => edge.from === fromId && edge.outcome === outcome,
	);
	if (outcome !== undefined && !taken) {
		next = addEdge(next, fromId, outcome, added.id)?.flow ?? next;
	}
	return { flow: next, id: added.id };
}

/**
 * A new node that reads the main output of `from`, for a kind that takes a
 * value (`NodeDefinition.takeValue`).
 */
function readingFrom(node: FlowNode, from: FlowNode): FlowNode {
	const field = mainOutputField(from);
	const ref = `${from.id}.${field}`;
	return definitionOf(node).takeValue(node, {
		ref,
		list: listIn(from, field),
		path: jsonataPath(ref),
	});
}

/**
 * The reference of the list in a field: the field when it is a list, or
 * its one list one level below (`news.data.items`). Else the field.
 */
function listIn(from: FlowNode, field: string): string {
	const ref = `${from.id}.${field}`;
	const shape = outputFieldShape(from, field);
	if (shape?.type === "array") return ref;
	const properties = shape?.properties;
	if (properties === null || typeof properties !== "object") return ref;
	const lists = Object.entries(properties).filter(
		([, value]) =>
			value !== null &&
			typeof value === "object" &&
			(value as Record<string, unknown>).type === "array",
	);
	return lists.length === 1 ? `${ref}.${lists[0]?.[0]}` : ref;
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

/**
 * Moves every listed node, once. A drag, of one node or many, and "Lay out"
 * use this, so the flow is copied once however many nodes move. A node
 * that is listed is a new object, also when it stays at the same place.
 */
export function moveNodes(
	flow: Flow,
	positions: ReadonlyMap<string, Position>,
): Flow {
	if (positions.size === 0) return flow;
	let moved = false;
	const nodes = flow.nodes.map((node) => {
		const position = positions.get(node.id);
		if (!position) return node;
		moved = true;
		return {
			...node,
			position: { x: Math.round(position.x), y: Math.round(position.y) },
		};
	});
	return moved ? { ...flow, nodes } : flow;
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
 * Renames a node everywhere: its edges, the start, its Section,
 * `{{old…}}` references in the flow's templates and outputs, and `old`
 * where its rules and expressions read it.
 */
export function renameNode(flow: Flow, from: string, to: string): Flow {
	if (from === to) return flow;
	const renamed = renameInFlow(
		{
			...flow,
			nodes: flow.nodes.map((node) =>
				node.id === from ? { ...node, id: to } : node,
			),
		},
		from,
		to,
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

/** Whether the edge closes a loop: its source is reachable again from its target. */
export function edgeInLoop(flow: Flow, edge: FlowEdge): boolean {
	const outgoing = new Map<string, string[]>();
	for (const next of flow.edges) {
		const list = outgoing.get(next.from);
		if (list) list.push(next.to);
		else outgoing.set(next.from, [next.to]);
	}
	const seen = new Set<string>();
	const queue = [edge.to];
	for (let head = 0; head < queue.length; head++) {
		const id = queue[head] as string;
		if (id === edge.from) return true;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const to of outgoing.get(id) ?? []) queue.push(to);
	}
	return false;
}
