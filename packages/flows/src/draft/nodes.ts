/** New nodes and flows, and edits of one node. */

import { FLOW_VERSION, type Flow, type FlowNode } from "../flow";
import {
	type AgentNode,
	agentNode,
	type CallEach,
	canMakeValue,
	type DecidedBy,
	type DecisionNode,
	decisionDecider,
	type ListSource,
	type NodeDefaults,
	type ToolNode,
	type ValueBy,
	type ValueDeciderName,
	type ValueNode,
	type VariableWrite,
	valueDeciderNameSchema,
	type WaitUntil,
} from "../nodes";
import { typedOutput } from "../shapes";

/**
 * Changes who decides. A rule's `when` fields go, and `title`,
 * `lockScreen`, `deadline`, the brief and the options' impacts go when a
 * person no longer decides. Switched to a model, the
 * node starts on the decider from Settings and that decider's default
 * model; switched away, the profile, the decider and the model go, as
 * only a model reads them.
 */
export function withDecidedBy(
	node: DecisionNode,
	by: DecidedBy,
	defaults: NodeDefaults = {},
): DecisionNode {
	if (by === node.by) return node;
	const options = node.options.map(({ when, impact, ...option }) => ({
		...option,
		...(by === "rule" && when !== undefined ? { when } : {}),
		...(by === "person" && impact !== undefined ? { impact } : {}),
	}));
	const {
		lockScreen,
		deadline,
		// Only a person reads the brief.
		urgency,
		situation,
		background,
		recommend,
		fillBrief,
		decider: _decider,
		model: _model,
		profile: _profile,
		// Only a model climbs a cascade: a switch drops it.
		cascade: _cascade,
		// Only a person sees a title.
		title: _title,
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
		...(by === "person"
			? withoutUndefined({
					urgency,
					situation,
					background,
					recommend,
					fillBrief,
				})
			: {}),
		by,
		options,
	};
}

/** The fields that are set. */
function withoutUndefined<T extends Record<string, unknown>>(
	fields: T,
): Partial<T> {
	return Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== undefined),
	) as Partial<T>;
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
 * Changes who makes the value. The expression and the prompt both stay, for
 * when their mode comes back. A model starts on the first decider that can
 * make a value; a rule or a person drops the profile, the decider and the
 * model, as only a model reads them. Only a person reads the choices, the
 * attachments, the deadline, the default and the brief: another maker
 * drops them.
 */
export function withValueBy(node: ValueNode, by: ValueBy): ValueNode {
	if (by === node.by) return node;
	const {
		decider,
		model: _model,
		profile: _profile,
		cascade: _cascade,
		choices: _choices,
		attachments: _attachments,
		deadline: _deadline,
		default: _default,
		// Only a person sees a title and the brief.
		title: _title,
		urgency: _urgency,
		situation: _situation,
		background: _background,
		fillBrief: _fillBrief,
		...rest
	} = node;
	if (by !== "model") return { ...rest, by };
	return {
		...rest,
		...(node.cascade === undefined ? {} : { cascade: node.cascade }),
		...(node.profile === undefined ? {} : { profile: node.profile }),
		...(node.model === undefined ? {} : { model: node.model }),
		by,
		decider:
			decider !== undefined && canMakeValue(decider)
				? decider
				: FIRST_VALUE_DECIDER,
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
		case "any":
			return {
				kind: "any",
				signal: { name: "" },
				command: { command: "", everyMinutes: 10 },
			};
		case "url":
			return { kind: "url", url: "", everyMinutes: 5 };
	}
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

/**
 * The node with the output schema a person set: it counts as confirmed,
 * so a schema Night Shift inferred loses its mark (`outputInferred`).
 * Pass the node's own schema to confirm it as it is. Undefined removes the
 * schema, except on a Value node, which keeps the one it has. A node type
 * without an output schema (`typedOutput`) stays as it is.
 */
export function withOutputSchema<T extends FlowNode>(
	node: T,
	output: Record<string, unknown> | undefined,
): T {
	if (typedOutput(node) === null) return node;
	const {
		output: kept,
		outputInferred: _,
		...rest
	} = node as T & { output?: Record<string, unknown>; outputInferred?: true };
	const schema = output ?? (node.type === "value" ? kept : undefined);
	return (schema === undefined ? rest : { ...rest, output: schema }) as T;
}

/**
 * The Tool node with the tool of that name. The shape the server gives
 * for the tool's answer (`outputSchema`) becomes the node's output schema,
 * marked inferred: no person wrote it. A schema a person wrote or
 * confirmed stays. An inferred one of another tool goes.
 */
export function withTool(
	node: ToolNode,
	tool: string,
	outputSchema?: Record<string, unknown>,
): ToolNode {
	if (node.output !== undefined && node.outputInferred !== true) {
		return { ...node, tool };
	}
	const { output: _, outputInferred: __, ...rest } = node;
	return outputSchema === undefined
		? { ...rest, tool }
		: { ...rest, tool, output: outputSchema, outputInferred: true };
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
