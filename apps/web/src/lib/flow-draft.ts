import {
	type AgentNode,
	type CommandNode,
	type DecisionNode,
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	type FlowIssue,
	type FlowNode,
	type FlowNodeType,
	flowSchema,
	type GateNode,
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
/** A small, fast model is enough to pick a label. */
export const DEFAULT_DECISION_MODEL = "haiku";
export const MODEL_SUGGESTIONS = ["sonnet", "opus", "haiku"];

/** A Decision label or a Gate choice. Each one is an outcome of its node. */
export type NodeOption = DecisionNode["labels"][number];
/** A node whose outcomes are its own options. */
export type OptionNode = DecisionNode | GateNode;

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
		tools: [],
	};
}

/** The command starts empty; the issues panel asks for one. */
export function commandNode(id: string, position: Position): CommandNode {
	return { id, type: "command", position, command: "" };
}

/** The prompt starts empty; the issues panel asks for one. */
export function decisionNode(id: string, position: Position): DecisionNode {
	return {
		id,
		type: "decision",
		position,
		prompt: "",
		labels: [
			{ name: "continue", description: "The work is on track." },
			{ name: "stop", description: "Something needs a person first." },
		],
		decider: "claude-code",
		model: DEFAULT_DECISION_MODEL,
		tools: [],
	};
}

/** The question starts empty; the issues panel asks for one. */
export function gateNode(id: string, position: Position): GateNode {
	return {
		id,
		type: "gate",
		position,
		question: "",
		choices: [{ name: "approve" }, { name: "reject" }],
	};
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

const NEW_NODE: Record<
	FlowNodeType,
	{ id: string; create: (id: string, position: Position) => FlowNode }
> = {
	agent: { id: "agent", create: agentNode },
	command: { id: "check", create: commandNode },
	decision: { id: "decide", create: decisionNode },
	gate: { id: "ask", create: gateNode },
};

export function addNode(flow: Flow, type: FlowNodeType, position: Position) {
	const id = uniqueNodeId(flow, NEW_NODE[type].id);
	const node = NEW_NODE[type].create(id, position);
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

/** Applies `rewrite` to the node's template text: its prompt, command or question. */
function rewriteTemplates(
	node: FlowNode,
	rewrite: (text: string) => string,
): FlowNode {
	switch (node.type) {
		case "agent":
		case "decision":
			return { ...node, prompt: rewrite(node.prompt) };
		case "command":
			return { ...node, command: rewrite(node.command) };
		case "gate":
			return { ...node, question: rewrite(node.question) };
	}
}

/**
 * Renames a node everywhere: its edges, the start, and `{{old.field}}`
 * references in prompts, commands and questions.
 */
export function renameNode(flow: Flow, from: string, to: string): Flow {
	if (from === to) return flow;
	const reference = new RegExp(`\\{\\{(\\s*)${from}(\\s*)\\.`, "g");
	const rewrite = (text: string) => text.replace(reference, `{{$1${to}$2.`);
	return {
		...flow,
		start: flow.start === from ? to : flow.start,
		nodes: flow.nodes.map((node) =>
			rewriteTemplates(node.id === from ? { ...node, id: to } : node, rewrite),
		),
		edges: flow.edges.map((edge) => ({
			...edge,
			from: edge.from === from ? to : edge.from,
			to: edge.to === from ? to : edge.to,
		})),
	};
}

/** The labels of a Decision node or the choices of a Gate node. */
export function nodeOptions(node: OptionNode): NodeOption[] {
	return node.type === "decision" ? node.labels : node.choices;
}

export function withOptions<T extends OptionNode>(
	node: T,
	options: NodeOption[],
): T {
	return node.type === "decision"
		? { ...node, labels: options }
		: { ...node, choices: options };
}

function changeOptions(
	flow: Flow,
	nodeId: string,
	change: (options: NodeOption[]) => NodeOption[],
): Flow {
	return updateNode(flow, nodeId, (node) =>
		node.type === "decision" || node.type === "gate"
			? withOptions(node, change(nodeOptions(node)))
			: node,
	);
}

/**
 * Renames a Decision label or Gate choice, and moves the node's edges on that
 * outcome along with it.
 */
export function renameOutcome(
	flow: Flow,
	nodeId: string,
	index: number,
	to: Outcome,
): Flow {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node || (node.type !== "decision" && node.type !== "gate")) return flow;
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
 * Removes a Decision label or Gate choice, and the node's edges on it (unless
 * another option keeps the same name). Returns what it removed, for an undo.
 */
export function removeOutcome(
	flow: Flow,
	nodeId: string,
	index: number,
): { flow: Flow; option: NodeOption | null; dropped: FlowEdge[] } {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node || (node.type !== "decision" && node.type !== "gate")) {
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
	if (!node || (node.type !== "decision" && node.type !== "gate")) return flow;
	if (nodeOptions(node).some((other) => other.name === option.name)) {
		return flow;
	}
	const next = changeOptions(flow, nodeId, (options) => [
		...options.slice(0, index),
		option,
		...options.slice(index),
	]);
	const ids = new Set(next.nodes.map((candidate) => candidate.id));
	const edgeIds = new Set(next.edges.map((edge) => edge.id));
	const back = dropped.filter(
		(edge) => ids.has(edge.from) && ids.has(edge.to) && !edgeIds.has(edge.id),
	);
	return { ...next, edges: [...next.edges, ...back] };
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
	prompt: "Write what to decide.",
	question: "Write the question.",
	labels: "A decision needs at least two labels.",
	choices: "A gate needs at least one choice.",
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
				FIELD_MESSAGES[field] ??
				optionMessage(flow, index, rest) ??
				`${field || String(scope)}: ${issue.message}`;
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

/** A bad label or choice name: `labels.1.name` reads as `Label "Yes": …`. */
function optionMessage(
	flow: Flow,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [list, at, field] = rest;
	if ((list !== "labels" && list !== "choices") || field !== "name") return;
	const node = typeof index === "number" ? flow.nodes[index] : undefined;
	if (!node || (node.type !== "decision" && node.type !== "gate")) return;
	const name = nodeOptions(node)[Number(at)]?.name ?? "";
	const kind = list === "labels" ? "Label" : "Choice";
	return name === ""
		? `A ${kind.toLowerCase()} has no name.`
		: `${kind} "${name}": use lowercase letters, digits and -, starting with a letter.`;
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

/** The first line of a decision's prompt. */
export function firstLine(text: string): string {
	return text.trim().split("\n")[0] ?? "";
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
