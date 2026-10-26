/** New nodes and flows, and edits of one node. */

import { FLOW_VERSION, type Flow, type FlowNode } from "../document";
import {
	type AgentNode,
	type CallEach,
	type CallNode,
	type CommandNode,
	canMakeValue,
	DEFAULT_COMMAND_EXITS,
	type DecidedBy,
	type DecisionNode,
	decisionDecider,
	type EndNode,
	type JoinNode,
	type ListSource,
	type ToolNode,
	type ValueBy,
	type ValueDeciderName,
	type ValueNode,
	type VariableWrite,
	valueDeciderNameSchema,
	type WaitNode,
	type WaitUntil,
} from "../nodes";

export type Position = { x: number; y: number };

export const DEFAULT_MODEL = "sonnet";

/**
 * What a new Agent or Decision node starts with: the daemon's settings
 * (Settings → New nodes). Each one left out keeps the built-in default.
 */
export type NodeDefaults = {
	agentHarness?: AgentNode["harness"];
	agentModel?: string;
	agentPermissionMode?: AgentNode["permissionMode"];
	decisionDecider?: DecisionNode["decider"];
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
	return {
		id,
		type: "command",
		position,
		command: "",
		output: "text",
		exits: DEFAULT_COMMAND_EXITS.map((exit) => ({ ...exit })),
	};
}

/**
 * A rule decides, with the options yes and no and no rule yet; the issues
 * panel asks for one. The inspector switches who decides: you (a Gate) or
 * a model (`withDecidedBy`).
 */
export function decisionNode(id: string, position: Position): DecisionNode {
	return {
		id,
		type: "decision",
		position,
		prompt: "",
		options: [{ name: "yes" }, { name: "no" }],
		by: "rule",
	};
}

/**
 * A Gate, from the palette: a Decision you decide, with the options yes
 * and no and no question yet; the issues panel asks for one.
 */
export function gateNode(id: string, position: Position): DecisionNode {
	return withDecidedBy(decisionNode(id, position), "person");
}

/**
 * Changes who decides. A rule's `when` fields go, and `lockScreen` and
 * `deadline` go when a person no longer decides. Switched to a model, the
 * node starts on the decider from Settings and that decider's default
 * model; switched away, the decider and the model go, as only a model
 * reads them.
 */
export function withDecidedBy(
	node: DecisionNode,
	by: DecidedBy,
	defaults: NodeDefaults = {},
): DecisionNode {
	if (by === node.by) return node;
	const options =
		by === "rule"
			? node.options
			: node.options.map(({ when: _, ...option }) => option);
	const {
		lockScreen,
		deadline,
		decider: _decider,
		model: _model,
		...rest
	} = node;
	if (by === "model") {
		return {
			...rest,
			by,
			options,
			decider: defaults.decisionDecider ?? decisionDecider({}),
		};
	}
	return {
		...rest,
		...(by === "person" && lockScreen !== undefined ? { lockScreen } : {}),
		...(by === "person" && deadline !== undefined ? { deadline } : {}),
		by,
		options,
	};
}

/** Ends the run as done, with no message yet. */
export function endNode(id: string, position: Position): EndNode {
	return { id, type: "end", position, status: "done", message: "" };
}

/** Runs a flow once. The called flow starts empty; the issues panel asks for one. */
export function callNode(id: string, position: Position): CallNode {
	return { id, type: "call", position, flow: "", inputs: {} };
}

/**
 * What a Call node loops over when "once per item" is switched on: a JSON
 * list by default, often another node's output. The list starts empty; the
 * issues panel asks for it.
 */
export function defaultEach(): CallEach {
	return {
		source: emptySource("json"),
		as: "item",
		branch: "per-item",
		haltOn: ["halt"],
	};
}

/** The first decider that can make a value. */
// The enum is not empty.
const FIRST_VALUE_DECIDER = valueDeciderNameSchema
	.options[0] as ValueDeciderName;

/**
 * A rule makes the value, with an object schema and no expression yet; the
 * issues panel asks for one. Switched to a model, the node starts on the
 * first decider that can make a value (`withValueBy`).
 */
export function valueNode(id: string, position: Position): ValueNode {
	return {
		id,
		type: "value",
		position,
		by: "rule",
		expression: "",
		output: { type: "object" },
	};
}

/**
 * Changes who makes the value. The expression and the prompt both stay, for
 * when their mode comes back. A model starts on the first decider that can
 * make a value; a rule drops the decider and the model, as only a model
 * reads them.
 */
export function withValueBy(node: ValueNode, by: ValueBy): ValueNode {
	if (by === node.by) return node;
	const { decider, model: _model, ...rest } = node;
	if (by === "rule") return { ...rest, by };
	return {
		...node,
		by,
		decider:
			decider !== undefined && canMakeValue(decider)
				? decider
				: FIRST_VALUE_DECIDER,
	};
}

/** Waits 15 minutes until the inspector says otherwise. */
export function waitNode(id: string, position: Position): WaitNode {
	return {
		id,
		type: "wait",
		position,
		until: { kind: "duration", minutes: 15 },
	};
}

/** What a Wait node of each kind starts with when the person switches to it. */
export function emptyUntil(kind: WaitUntil["kind"]): WaitUntil {
	switch (kind) {
		case "duration":
			return { kind: "duration", minutes: 15 };
		case "time":
			return { kind: "time", at: "" };
		case "command":
			return { kind: "command", command: "", everyMinutes: 5 };
		case "signal":
			return { kind: "signal", name: "" };
	}
}

/** The connection and the tool start empty; the issues panel asks for them. */
export function toolNode(id: string, position: Position): ToolNode {
	return {
		id,
		type: "tool",
		position,
		connection: "",
		tool: "",
		arguments: {},
	};
}

/** A Join waits for every branch until the person picks `first`. */
export function joinNode(id: string, position: Position): JoinNode {
	return { id, type: "join", position, wait: "all" };
}

export function emptySource(kind: ListSource["kind"]): ListSource {
	switch (kind) {
		case "json":
			return { kind: "json", value: "" };
		case "command":
			return { kind: "command", command: "" };
	}
}

/** Replaces a node's variable writes. None: the node has no `set` at all. */
export function withWrites<T extends FlowNode>(
	node: T,
	set: VariableWrite[],
): T {
	const { set: _, ...rest } = node;
	return (set.length > 0 ? { ...rest, set } : rest) as T;
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
 * A new flow for a Call that runs once per item: one JSON input (named
 * `as`) that takes the element, and one Agent node that works on it.
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

/** The connections an Agent or Tool node names that the daemon does not have. */
export function missingConnections(
	node: FlowNode,
	known: readonly string[],
): string[] {
	const named =
		node.type === "agent"
			? (node.connections ?? [])
			: node.type === "tool" && node.connection !== ""
				? [node.connection]
				: [];
	return named.filter((name) => !known.includes(name));
}
