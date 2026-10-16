import {
	type AgentNode,
	type CommandNode,
	type DecisionNode,
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	type FlowInputDef,
	type FlowIssue,
	type FlowNode,
	type FlowNodeType,
	type FlowOutputDef,
	type ForEachNode,
	flowSchema,
	type GateNode,
	type ListSource,
	nameSchema,
	nodeOutcomes,
	nodeOutputFields,
	type Outcome,
	outputFieldsByType,
	type Policy,
	runFields,
	type SubflowNode,
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

/** The flow files of a project, by name. Null when a file does not load. */
export type ProjectFlowMap = Readonly<Record<string, Flow | null>>;

/** A Decision label, a Gate choice, or an Agent's own outcome. Each one is an outcome of its node. */
export type NodeOption = DecisionNode["labels"][number];
/** A node whose outcomes are its own options. */
export type OptionNode = DecisionNode | GateNode | AgentNode;

/**
 * What a new Agent or Decision node starts with: the daemon's settings
 * (Settings → New nodes). Each one left out keeps the built-in default.
 */
export type NodeDefaults = {
	agentHarness?: AgentNode["harness"];
	agentModel?: string;
	agentPermissionMode?: AgentNode["permissionMode"];
	decisionModel?: string;
};

export function agentNode(
	id: string,
	position: Position,
	defaults: NodeDefaults = {},
): AgentNode {
	return {
		id,
		type: "agent",
		position,
		prompt: "",
		harness: defaults.agentHarness ?? "claude-code",
		model: defaults.agentModel ?? DEFAULT_MODEL,
		permissionMode: defaults.agentPermissionMode ?? "acceptEdits",
		session: "fresh",
	};
}

/** The command starts empty; the issues panel asks for one. */
export function commandNode(id: string, position: Position): CommandNode {
	return { id, type: "command", position, command: "" };
}

/** The prompt starts empty; the issues panel asks for one. */
export function decisionNode(
	id: string,
	position: Position,
	defaults: NodeDefaults = {},
): DecisionNode {
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
		model: defaults.decisionModel ?? DEFAULT_DECISION_MODEL,
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

/** The called flow starts empty; the issues panel asks for one. */
export function subflowNode(id: string, position: Position): SubflowNode {
	return { id, type: "subflow", position, flow: "", inputs: {} };
}

/**
 * A JSON list by default, often another node's output. The list and the
 * called flow start empty; the issues panel asks for them.
 */
export function forEachNode(id: string, position: Position): ForEachNode {
	return {
		id,
		type: "foreach",
		position,
		source: emptySource("json"),
		flow: "",
		as: "item",
		inputs: {},
		branch: "per-item",
		haltOn: ["halt"],
	};
}

export function emptySource(kind: ListSource["kind"]): ListSource {
	switch (kind) {
		case "json":
			return { kind: "json", value: "" };
		case "command":
			return { kind: "command", command: "" };
		case "files":
			return { kind: "files", glob: "" };
	}
}

/** How each kind of list source reads in a picker. */
export const SOURCE_KINDS: Record<ListSource["kind"], string> = {
	json: "A JSON value",
	command: "A command",
	files: "Files (a glob)",
};

/** One line for a source: where the elements come from. Empty when it is not set yet. */
export function sourceSummary(source: ListSource): string {
	switch (source.kind) {
		case "json":
			return source.value.trim();
		case "command":
			return source.command.trim().split("\n")[0] ?? "";
		case "files":
			return source.glob.trim();
	}
}

/**
 * The built-in defaults of the run policy. A number the flow leaves out comes
 * from the daemon's settings; these stand in while the settings load.
 */
export const POLICY_DEFAULTS: Required<Policy> = {
	usageLimitFirstWaitMinutes: 5,
	usageLimitMaxWaitMinutes: 60,
	networkGraceMinutes: 240,
	maxSteps: 500,
	resumeInterruptedRuns: true,
};

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

/**
 * The names a template can read in this flow: node ids and inputs share one
 * namespace, and `run` is reserved.
 */
export function takenNames(flow: Flow): Set<string> {
	return new Set([
		"run",
		...flow.nodes.map((node) => node.id),
		...flow.inputs.map((input) => input.name),
	]);
}

/** `base`, else `base_2`, `base_3`, … whichever no node or input uses yet. */
export function uniqueName(flow: Flow, base: string): string {
	const taken = takenNames(flow);
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base}_${n}`;
		if (!taken.has(name)) return name;
	}
}

/** `base`, else `base_2`, … among the flow's outputs. */
export function uniqueOutputName(flow: Flow, base: string): string {
	const taken = new Set(flow.outputs.map((output) => output.name));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base}_${n}`;
		if (!taken.has(name)) return name;
	}
}

/**
 * Rewrites the references to `from` in a template: `{{from}}`,
 * `{{ from.path.to }}`. Other names that start the same stay.
 */
export function renameRefs(text: string, from: string, to: string): string {
	const reference = new RegExp(
		`(\\{\\{\\s*)${from}(?=(?:\\.[A-Za-z0-9_-]+)*\\s*\\}\\})`,
		"g",
	);
	return text.replace(reference, `$1${to}`);
}

/** Whether the template is exactly one reference, so it keeps a JSON value as it is. */
export function isSingleRef(text: string): boolean {
	return /^\s*\{\{\s*[a-z][a-z0-9_]*(?:\.[A-Za-z0-9_-]+)*\s*\}\}\s*$/.test(
		text,
	);
}

/**
 * Renames an input and the `{{old…}}` references in this flow's nodes and
 * outputs. Flows that call this one keep binding the old name.
 */
export function renameInput(flow: Flow, index: number, to: string): Flow {
	const from = flow.inputs[index]?.name;
	if (from === undefined || from === to) return flow;
	const next = rewriteFlowTemplates(flow, (text) => renameRefs(text, from, to));
	return {
		...next,
		inputs: next.inputs.map((input, at) =>
			at === index ? { ...input, name: to } : input,
		),
	};
}

/** A new flow: one Agent node named `worker`. */
export function newFlow(defaults?: NodeDefaults): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "worker",
		nodes: [agentNode("worker", { x: 0, y: 0 }, defaults)],
		edges: [],
	};
}

/**
 * A new flow for a For Each: one JSON input (named `as`) that takes the
 * element, and one Agent node that works on it.
 */
export function newElementFlow(as: string, defaults?: NodeDefaults): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [{ name: as, type: "json", required: true }],
		outputs: [],
		start: "worker",
		nodes: [
			{
				...agentNode("worker", { x: 0, y: 0 }, defaults),
				prompt: `Work on {{${as}.title}}.\n\nThe item:\n{{${as}}}`,
			},
		],
		edges: [],
	};
}

/** `base`, else `base_2`, `base_3`, … whichever is free. */
export function uniqueNodeId(flow: Flow, base: string): string {
	return uniqueName(flow, base);
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
	gate: { id: "ask", create: gateNode },
	subflow: { id: "call", create: subflowNode },
	foreach: { id: "each", create: forEachNode },
};

/** Adds a node of `type`; a new Agent or Decision node starts with `defaults`. */
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

function rewriteBindings(
	bindings: Record<string, string>,
	rewrite: (text: string) => string,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(bindings).map(([name, value]) => [name, rewrite(value)]),
	);
}

function rewriteSource(
	source: ListSource,
	rewrite: (text: string) => string,
): ListSource {
	switch (source.kind) {
		case "json":
			return { ...source, value: rewrite(source.value) };
		case "command":
			return { ...source, command: rewrite(source.command) };
		case "files":
			return { ...source, glob: rewrite(source.glob) };
	}
}

/**
 * Applies `rewrite` to every template of the node: a prompt, a command, a
 * question, a list source, and the bindings of a called flow's inputs.
 */
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
		case "subflow":
			return { ...node, inputs: rewriteBindings(node.inputs, rewrite) };
		case "foreach":
			return {
				...node,
				source: rewriteSource(node.source, rewrite),
				inputs: rewriteBindings(node.inputs, rewrite),
			};
	}
}

/** Applies `rewrite` to every template of the flow: its nodes and its outputs. */
function rewriteFlowTemplates(
	flow: Flow,
	rewrite: (text: string) => string,
): Flow {
	return {
		...flow,
		nodes: flow.nodes.map((node) => rewriteTemplates(node, rewrite)),
		outputs: flow.outputs.map((output) => ({
			...output,
			value: rewrite(output.value),
		})),
	};
}

/**
 * Renames a node everywhere: its edges, the start, and `{{old…}}`
 * references in the flow's templates and outputs.
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
	return {
		...renamed,
		start: flow.start === from ? to : flow.start,
		edges: flow.edges.map((edge) => ({
			...edge,
			from: edge.from === from ? to : edge.from,
			to: edge.to === from ? to : edge.to,
		})),
	};
}

export function isOptionNode(node: FlowNode): node is OptionNode {
	return (
		node.type === "decision" || node.type === "gate" || node.type === "agent"
	);
}

/** The labels of a Decision node, the choices of a Gate node, or an Agent's own outcomes. */
export function nodeOptions(node: OptionNode): NodeOption[] {
	switch (node.type) {
		case "decision":
			return node.labels;
		case "gate":
			return node.choices;
		case "agent":
			return node.outcomes ?? [];
	}
}

export function withOptions<T extends OptionNode>(
	node: T,
	options: NodeOption[],
): T {
	if (node.type === "decision") return { ...node, labels: options };
	if (node.type === "gate") return { ...node, choices: options };
	return { ...node, outcomes: options };
}

/** What an option is called on its node: a label, a choice, or an outcome. */
export function optionNoun(node: FlowNode): "label" | "choice" | "outcome" {
	return node.type === "decision"
		? "label"
		: node.type === "gate"
			? "choice"
			: "outcome";
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
 * The Agent node naming these connections, in the order given and without
 * repeats. None left drops the field, so the file stays minimal.
 */
export function withConnections(
	node: AgentNode,
	names: readonly string[],
): AgentNode {
	const unique = [...new Set(names)];
	const { connections: _, ...rest } = node;
	return unique.length > 0 ? { ...rest, connections: unique } : rest;
}

/** Sets the connections an Agent node names; see `withConnections`. */
export function setAgentConnections(
	flow: Flow,
	nodeId: string,
	names: readonly string[],
): Flow {
	return updateNode(flow, nodeId, (node) =>
		node.type === "agent" ? withConnections(node, names) : node,
	);
}

/** The connections an Agent node names that the daemon does not have. */
export function missingConnections(
	node: FlowNode,
	known: readonly string[],
): string[] {
	if (node.type !== "agent") return [];
	return (node.connections ?? []).filter((name) => !known.includes(name));
}

/** What the editor says about a connection the daemon does not have. */
export function missingConnectionMessage(name: string): string {
	return `No connection named ${name}. The flow cannot run until you add it on the Agents page.`;
}

/** What the editor says about a profile the daemon does not have. */
export function missingProfileMessage(name: string): string {
	return `No profile named ${name}. The flow cannot run until you add it on the Agents page.`;
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

/** One `{{…}}` a template can use. */
export type TemplateVariable = {
	/** The full reference, `{{planner.data}}`. */
	text: string;
	/** What the chip shows, `data`. */
	label: string;
	/** Holds JSON: a path can go below it, `{{planner.data.tasks}}`. */
	json: boolean;
	/** Shown as the chip's tooltip. */
	description?: string;
};

export type VariableGroup = {
	/** A node id, `inputs`, or `run`. */
	scope: string;
	variables: TemplateVariable[];
};

/** The flow a Subflow or For Each node calls, when it loads. */
export function calledFlow(
	node: FlowNode,
	flows: ProjectFlowMap | undefined,
): Flow | null {
	if (node.type !== "subflow" && node.type !== "foreach") return null;
	if (node.flow === "" || !flows) return null;
	return flows[node.flow] ?? null;
}

/** The top-level keys of a JSON Schema object, with whether each holds JSON. */
export function schemaFields(
	schema: unknown,
): { name: string; json: boolean }[] {
	if (!schema || typeof schema !== "object") return [];
	const properties = (schema as { properties?: unknown }).properties;
	if (!properties || typeof properties !== "object") return [];
	return Object.entries(properties as Record<string, unknown>)
		.filter(([name]) => /^[A-Za-z0-9_-]+$/.test(name))
		.map(([name, field]) => {
			const type =
				field && typeof field === "object"
					? (field as { type?: unknown }).type
					: undefined;
			return { name, json: type === "array" || type === "object" };
		});
}

const JSON_FIELDS: readonly string[] = ["data", "results"];

function nodeVariables(
	node: FlowNode,
	flows: ProjectFlowMap | undefined,
): TemplateVariable[] {
	const called = calledFlow(node, flows);
	const own: readonly string[] = outputFieldsByType[node.type];
	const variables: TemplateVariable[] = nodeOutputFields(node, called).map(
		(field) => {
			const output = own.includes(field)
				? undefined
				: called?.outputs.find((candidate) => candidate.name === field);
			return {
				text: `{{${node.id}.${field}}}`,
				label: field,
				// A called flow's output may hold JSON: a path can go below it.
				json: JSON_FIELDS.includes(field) || output !== undefined,
				description: output
					? (output.description ??
						`An output of ${node.type === "subflow" ? node.flow : "the called flow"}`)
					: undefined,
			};
		},
	);
	if (node.type === "agent") {
		for (const field of schemaFields(node.output)) {
			variables.push({
				text: `{{${node.id}.data.${field.name}}}`,
				label: `data.${field.name}`,
				json: field.json,
				description: "A field of the output schema",
			});
		}
	}
	return variables;
}

/**
 * The `{{…}}` variables a node can use: the flow's inputs, other nodes'
 * outputs, and the run's fields. With `nodeId` null (the flow's outputs),
 * every node counts. `flows` adds the outputs of the flows that Subflow
 * nodes call.
 */
export function templateVariables(
	flow: Flow,
	nodeId: string | null,
	flows?: ProjectFlowMap,
): VariableGroup[] {
	const inputs: VariableGroup[] =
		flow.inputs.length > 0
			? [
					{
						scope: "inputs",
						variables: flow.inputs.map((input) => ({
							text: `{{${input.name}}}`,
							label: input.name,
							json: input.type === "json",
							description: input.description ?? input.label,
						})),
					},
				]
			: [];
	const nodes = flow.nodes
		.filter((node) => node.id !== nodeId)
		.map((node) => ({
			scope: node.id,
			variables: nodeVariables(node, flows),
		}));
	return [
		...inputs,
		...nodes,
		{
			scope: "run",
			variables: runFields.map((field) => ({
				text: `{{run.${field}}}`,
				label: field,
				json: false,
			})),
		},
	];
}

/** The flows of the project that call `name` through a Subflow or For Each node. */
export function callersOf(name: string, flows: ProjectFlowMap): string[] {
	return Object.entries(flows)
		.filter(
			([caller, flow]) =>
				caller !== name &&
				(flow?.nodes ?? []).some(
					(node) =>
						(node.type === "subflow" || node.type === "foreach") &&
						node.flow === name,
				),
		)
		.map(([caller]) => caller)
		.sort();
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
	outcomes: "An agent with its own outcomes needs at least one.",
	output: "The output schema must be a JSON object.",
	model: "Set a model.",
	skill: "The skill name is empty.",
	timeoutMinutes: "The timeout must be a whole number of minutes above 0.",
	max: "The max must be a whole number above 0.",
	id: "Use lowercase letters, digits and _, starting with a letter.",
	idleMinutes: "The idle timeout must be a whole number of minutes above 0.",
	flow: "Pick a flow to run.",
	as: "Pick the input that gets the item.",
	"source.value": "Set the list: a template that gives a JSON array.",
	"source.command": "The source command is empty.",
	"source.glob": "The glob is empty.",
	maxItems: "Max items must be a whole number above 0.",
};

const POLICY_MESSAGES: Record<string, string> = {
	usageLimitFirstWaitMinutes:
		"Run policy: the first usage-limit wait must be above 0.",
	usageLimitMaxWaitMinutes:
		"Run policy: the longest usage-limit wait must be above 0.",
	networkGraceMinutes: "Run policy: the network grace must be above 0.",
	maxSteps: "Run policy: max steps must be a whole number above 0.",
};

/**
 * Checks the draft: the schema first (what the API would refuse to save), then
 * `validateFlow` for meaning. Schema issues point at their node or edge.
 * `flows` holds the project's flow files by name, so Subflow and For Each
 * nodes can check the flows they call; leave it out while they load. `name`
 * is the draft's own file name: the draft stands in for that file, and a
 * flow that reaches itself is reported with the chain. `connections` and
 * `profiles` hold the names of the daemon's connections and Agent Profiles;
 * leave them out while they load.
 */
export function checkFlow(
	flow: Flow,
	flows?: ProjectFlowMap,
	name?: string,
	connections?: readonly string[],
	profiles?: readonly string[],
): FlowCheck {
	const issues: FlowIssue[] = [];
	const parsed = flowSchema.safeParse(flow);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const [scope, index, ...rest] = issue.path;
			const field = rest.map(String).join(".");
			const message =
				ioMessage(flow, scope, index, rest) ??
				FIELD_MESSAGES[field] ??
				optionMessage(flow, index, rest) ??
				bindingMessage(scope, index, rest) ??
				haltOnMessage(flow, index, rest) ??
				mcpMessage(flow, index, rest) ??
				(scope === "policy" ? POLICY_MESSAGES[String(index)] : undefined) ??
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

	if (connections) {
		for (const node of flow.nodes) {
			for (const missing of missingConnections(node, connections)) {
				issues.push({
					severity: "error",
					message: missingConnectionMessage(missing),
					nodeId: node.id,
				});
			}
		}
	}

	if (profiles) {
		for (const node of flow.nodes) {
			if (node.type !== "agent" || node.profile === undefined) continue;
			if (profiles.includes(node.profile)) continue;
			issues.push({
				severity: "error",
				message: missingProfileMessage(node.profile),
				nodeId: node.id,
			});
		}
	}

	let validatorError: string | null = null;
	try {
		issues.push(...validateFlow(flow, flows ? { flows, name } : undefined));
	} catch (error) {
		validatorError = error instanceof Error ? error.message : String(error);
	}
	return { issues, validatorError };
}

/** A bad label, choice or outcome name: `labels.1.name` reads as `Label "Yes": …`. */
function optionMessage(
	flow: Flow,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [list, at, field] = rest;
	if (
		(list !== "labels" && list !== "choices" && list !== "outcomes") ||
		field !== "name"
	)
		return;
	const node = typeof index === "number" ? flow.nodes[index] : undefined;
	if (!node || !isOptionNode(node)) return;
	const name = nodeOptions(node)[Number(at)]?.name ?? "";
	const kind =
		list === "labels" ? "Label" : list === "choices" ? "Choice" : "Outcome";
	return name === ""
		? `A ${kind.toLowerCase()} has no name.`
		: `${kind} "${name}": use lowercase letters, digits and -, starting with a letter.`;
}

/** A bad input or output of the flow: `inputs.0.name` reads as `Input "Epic": …`. */
function ioMessage(
	flow: Flow,
	scope: PropertyKey | undefined,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	if ((scope !== "inputs" && scope !== "outputs") || typeof index !== "number")
		return;
	const kind = scope === "inputs" ? "Input" : "Output";
	const name =
		(scope === "inputs" ? flow.inputs : flow.outputs)[index]?.name ?? "";
	if (rest[0] !== "name") {
		return `${kind} "${name}": ${rest.map(String).join(".")} is not valid.`;
	}
	return name === ""
		? `An ${kind.toLowerCase()} has no name.`
		: `${kind} "${name}": use lowercase letters, digits and _, starting with a letter.`;
}

/** A binding to a name that cannot be an input of the called flow. */
function bindingMessage(
	scope: PropertyKey | undefined,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [list, key] = rest;
	if (scope !== "nodes" || list !== "inputs" || typeof index !== "number")
		return;
	return `The binding "${String(key)}" is not a valid input name.`;
}

/** A bad halt-on label: `haltOn.0` reads as `Halt-on label "Stop": …`. */
function haltOnMessage(
	flow: Flow,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [list, at] = rest;
	if (list !== "haltOn") return;
	const node = typeof index === "number" ? flow.nodes[index] : undefined;
	if (node?.type !== "foreach") return;
	const name = node.haltOn[Number(at)] ?? "";
	return name === ""
		? "A halt-on label has no name."
		: `Halt-on label "${name}": use lowercase letters, digits and -, starting with a letter.`;
}

function mcpMessage(
	flow: Flow,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [field, name, key] = rest;
	if (field !== "mcpServers" || typeof index !== "number") return;
	if (!nameSchema.safeParse(name).success) {
		return `MCP server "${String(name ?? "")}": use lowercase letters, digits and _, starting with a letter.`;
	}
	if (key === "url") {
		return `MCP server "${String(name)}": set a full URL, such as https://mcp.example.com/mcp.`;
	}
	if (key === "command") {
		return `MCP server "${String(name)}": set the command to run.`;
	}
	return flow.nodes[index]?.type === "agent"
		? `MCP server "${String(name)}": ${rest.slice(2).map(String).join(".")} is not valid.`
		: undefined;
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
