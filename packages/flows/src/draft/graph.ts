/** Edits of the flow graph: nodes, edges, the start, inputs, outputs, variables and the run policy. */
import {
	type Flow,
	type FlowEdge,
	type FlowInputDef,
	type FlowNode,
	type FlowNodeType,
	type FlowOutputDef,
	type FlowVariableDef,
	nodeOutcomes,
	type Outcome,
	type Policy,
} from "../flow";
import { jsonataPath } from "../presets";
import { mainOutputField, outputFieldShape } from "../shapes";
import { takenNames, uniqueEdgeId, uniqueNodeId } from "./names";
import {
	agentNode,
	callNode,
	commandNode,
	convertNode,
	decisionNode,
	endNode,
	gateNode,
	joinNode,
	leaseNode,
	type NodeDefaults,
	type Position,
	serviceNode,
	sinceLastRunNode,
	toolNode,
	valueNode,
	waitNode,
	webRequestNode,
} from "./nodes";
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
 * What the palette adds: a node of a type, or a Decision by who decides it.
 * A Gate is a Decision you decide, a Branch one a rule decides. Both write a
 * `decision` node; a Decision by a model is the same node with another
 * `by`, set in the inspector.
 */
export type NewNodeKind = FlowNodeType | "gate" | "branch";

const NEW_NODE: Record<
	NewNodeKind,
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
	gate: { id: "gate", create: gateNode },
	branch: { id: "branch", create: decisionNode },
	call: { id: "call", create: callNode },
	value: { id: "value", create: valueNode },
	wait: { id: "wait", create: waitNode },
	tool: { id: "tool", create: toolNode },
	end: { id: "end", create: endNode },
	join: { id: "join", create: joinNode },
	lease: { id: "lease", create: leaseNode },
	service: { id: "service", create: serviceNode },
	"since-last-run": { id: "since-last-run", create: sinceLastRunNode },
	convert: { id: "convert", create: convertNode },
	"web-request": { id: "fetch", create: webRequestNode },
};

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
	const node = { ...callNode(id, position), flow: flowName };
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
export const NEW_NODE_TAKES = {
	agent: "nothing",
	command: "nothing",
	tool: "nothing",
	"web-request": "nothing",
	decision: "nothing",
	gate: "nothing",
	branch: "value",
	value: "value",
	"since-last-run": "value",
	convert: "value",
	wait: "nothing",
	lease: "nothing",
	service: "nothing",
	call: "nothing",
	join: "nothing",
	end: "nothing",
} as const satisfies Record<NewNodeKind, "nothing" | "value">;

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

/** A new node that reads the main output of `from`, for a kind that takes a value. */
function readingFrom(node: FlowNode, from: FlowNode): FlowNode {
	const field = mainOutputField(from);
	const ref = `${from.id}.${field}`;
	switch (node.type) {
		case "convert":
			return { ...node, value: `{{${ref}}}` };
		case "since-last-run":
			return { ...node, items: `{{${listIn(from, field)}}}` };
		case "value":
			return node.by === "rule"
				? { ...node, expression: jsonataPath(ref) }
				: node;
		case "decision":
			return node.by === "rule"
				? {
						...node,
						options: node.options.map((option, index) =>
							index === 0 ? { ...option, when: jsonataPath(ref) } : option,
						),
					}
				: node;
		default:
			return node;
	}
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
