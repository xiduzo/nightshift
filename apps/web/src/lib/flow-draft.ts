import {
	type AgentNode,
	type CommandNode,
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	type FlowIssue,
	type FlowNode,
	type FlowNodeType,
	flowSchema,
	type Outcome,
	outputFieldsByType,
	runFields,
	validateFlow,
} from "@nightshift/flows";

/**
 * Pure edits on a flow draft. The editor keeps the draft as a `Flow` and every
 * change goes through one of these, so the JSON on disk is exactly the draft.
 */

export type Position = { x: number; y: number };

export const DEFAULT_MODEL = "sonnet";
export const MODEL_SUGGESTIONS = ["sonnet", "opus", "haiku"];

export function agentNode(id: string, position: Position): AgentNode {
	return {
		id,
		type: "agent",
		position,
		prompt: "",
		harness: "claude-code",
		model: DEFAULT_MODEL,
		permissionMode: "acceptEdits",
		session: "fresh",
	};
}

/** The command starts empty; the issues panel asks for one. */
export function commandNode(id: string, position: Position): CommandNode {
	return { id, type: "command", position, command: "" };
}

/** A new flow: one Agent node named `worker`. */
export function newFlow(): Flow {
	return {
		version: FLOW_VERSION,
		start: "worker",
		nodes: [agentNode("worker", { x: 0, y: 0 })],
		edges: [],
	};
}

/** `base`, else `base_2`, `base_3`, … whichever is free. */
export function uniqueNodeId(flow: Flow, base: string): string {
	const taken = new Set(flow.nodes.map((node) => node.id));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const id = `${base}_${n}`;
		if (!taken.has(id)) return id;
	}
}

function uniqueEdgeId(flow: Flow, base: string): string {
	const taken = new Set(flow.edges.map((edge) => edge.id));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const id = `${base}-${n}`;
		if (!taken.has(id)) return id;
	}
}

export function addNode(flow: Flow, type: FlowNodeType, position: Position) {
	const id = uniqueNodeId(flow, type === "agent" ? "agent" : "check");
	const node =
		type === "agent" ? agentNode(id, position) : commandNode(id, position);
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

/** Removes the node and its edges. A removed start node hands start to the first node left. */
export function removeNode(flow: Flow, id: string): Flow {
	const nodes = flow.nodes.filter((node) => node.id !== id);
	return {
		...flow,
		nodes,
		edges: flow.edges.filter((edge) => edge.from !== id && edge.to !== id),
		start: flow.start === id ? (nodes[0]?.id ?? "") : flow.start,
	};
}

/**
 * Renames a node everywhere: its edges, the start, and `{{old.field}}`
 * references in prompts and commands.
 */
export function renameNode(flow: Flow, from: string, to: string): Flow {
	if (from === to) return flow;
	const reference = new RegExp(`\\{\\{(\\s*)${from}(\\s*)\\.`, "g");
	const rewrite = (text: string) => text.replace(reference, `{{$1${to}$2.`);
	return {
		...flow,
		start: flow.start === from ? to : flow.start,
		nodes: flow.nodes.map((node) => {
			const renamed = node.id === from ? { ...node, id: to } : node;
			return renamed.type === "agent"
				? { ...renamed, prompt: rewrite(renamed.prompt) }
				: { ...renamed, command: rewrite(renamed.command) };
		}),
		edges: flow.edges.map((edge) => ({
			...edge,
			from: edge.from === from ? to : edge.from,
			to: edge.to === from ? to : edge.to,
		})),
	};
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

/** The `{{…}}` variables a node can use: other nodes' outputs and the run's fields. */
export function templateVariables(flow: Flow, nodeId: string) {
	const nodes = flow.nodes
		.filter((node) => node.id !== nodeId)
		.map((node) => ({
			scope: node.id,
			variables: outputFieldsByType[node.type].map(
				(field) => `{{${node.id}.${field}}}`,
			),
		}));
	return [
		...nodes,
		{ scope: "run", variables: runFields.map((field) => `{{run.${field}}}`) },
	];
}

export type FlowCheck = {
	issues: FlowIssue[];
	/** Set when the validator itself failed, so the issues are only the schema's. */
	validatorError: string | null;
};

const FIELD_MESSAGES: Record<string, string> = {
	command: "The command is empty.",
	model: "Set a model.",
	skill: "The skill name is empty.",
	timeoutMinutes: "The timeout must be a whole number of minutes above 0.",
	max: "The max must be a whole number above 0.",
	id: "Use lowercase letters, digits and _, starting with a letter.",
};

/**
 * Checks the draft: the schema first (what the API would refuse to save), then
 * `validateFlow` for meaning. Schema issues point at their node or edge.
 */
export function checkFlow(flow: Flow): FlowCheck {
	const issues: FlowIssue[] = [];
	const parsed = flowSchema.safeParse(flow);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const [scope, index, ...rest] = issue.path;
			const field = rest.map(String).join(".");
			const message =
				FIELD_MESSAGES[field] ?? `${field || String(scope)}: ${issue.message}`;
			if (scope === "nodes" && typeof index === "number") {
				issues.push({
					severity: "error",
					message,
					nodeId: flow.nodes[index]?.id,
				});
			} else if (scope === "edges" && typeof index === "number") {
				issues.push({
					severity: "error",
					message,
					edgeId: flow.edges[index]?.id,
				});
			} else if (scope === "start") {
				issues.push({ severity: "error", message: "Pick a start node." });
			} else {
				issues.push({ severity: "error", message });
			}
		}
	}

	let validatorError: string | null = null;
	try {
		issues.push(...validateFlow(flow));
	} catch (error) {
		validatorError = error instanceof Error ? error.message : String(error);
	}
	return { issues, validatorError };
}

/** Whether the draft passes the schema, so `flows.save` accepts it. */
export function isSavable(flow: Flow): boolean {
	return flowSchema.safeParse(flow).success;
}

/** The first line of a prompt, or the skill call when the prompt is empty. */
export function agentSummary(node: AgentNode): string {
	const firstLine = node.prompt.trim().split("\n")[0] ?? "";
	if (node.skill) return `/${node.skill}${firstLine ? ` ${firstLine}` : ""}`;
	return firstLine;
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
