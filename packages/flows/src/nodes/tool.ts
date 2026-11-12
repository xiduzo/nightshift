import { z } from "zod";
import {
	jsonSchemaSchema,
	type NodeCheck,
	nameSchema,
	nodeBase,
	outputInferredSchema,
	placed,
} from "./base";
import {
	type BuiltInOutcome,
	endsOnPass,
	type NodeDefinition,
	noEndedLabel,
	noOwnColors,
	noSecrets,
	type Position,
	takesNoValue,
} from "./definition";

/**
 * Calls one tool of a Connection (an MCP server defined once on this
 * daemon) and gets its result, with no model in the loop. The MCP leg of
 * "flow + CLI + MCP": a Command node runs a CLI, a Tool node calls a tool.
 * The result's `isError`, a tool the server does not have, or a transport
 * failure is `fail`.
 */
export const toolNodeSchema = z.object({
	...nodeBase,
	...placed,
	type: z.literal("tool"),
	/** A Connection by name. A flow that names one the daemon does not have refuses to start. */
	connection: nameSchema,
	/** The tool's name, as the server lists it. */
	tool: z.string().min(1),
	/**
	 * A template per argument. A template that is one reference keeps its
	 * JSON value (`{{plan.data.tasks}}` stays an array); any other text is a
	 * string, unless the tool's input schema says number, integer, boolean,
	 * object or array: then the text is read as that.
	 */
	arguments: z.record(z.string(), z.string()).default({}),
	/**
	 * A JSON Schema for the step's `data`, as on an Agent node. Later nodes
	 * read its fields (`{{lookup.data.items}}`). Unset: the data has no
	 * declared shape.
	 */
	output: jsonSchemaSchema.optional(),
	/** Night Shift inferred `output` from a real output (`outputInferredSchema`). */
	outputInferred: outputInferredSchema,
});
export type ToolNode = z.infer<typeof toolNodeSchema>;

/**
 * data: the tool's structured content, else the JSON its text holds, else
 * null. text: the text content, joined.
 */
export const toolOutputFields = ["outcome", "data", "text", "visit"] as const;

/** A Tool node names a tool, and its argument templates read known names. */
export function checkToolNode(node: ToolNode, check: NodeCheck): void {
	if (node.tool.trim() === "") {
		check.error(`Tool node "${node.id}" needs the name of a tool.`);
	}
	for (const [name, value] of Object.entries(node.arguments)) {
		check.template(value, `argument "${name}"`);
	}
}

/** A new Tool node. The connection and the tool start empty; the issues panel asks for them. */
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

/** The Tool node type. */
export const toolDefinition = {
	type: "tool",
	label: "Tool",
	family: "do",
	standsIn: true,
	outcomes: () => ["pass", "fail"] satisfies BuiltInOutcome[],
	outcomeColor: noOwnColors,
	outputFields: toolOutputFields,
	check: checkToolNode,
	secrets: noSecrets,
	endsFlow: endsOnPass,
	endedLabel: noEndedLabel,
	touchesDevice: () => true,
	typedOutputField: () => "data",
	mainOutputField: () => "data",
	newNodes: { tool: { id: "tool", takes: "nothing", create: toolNode } },
	takeValue: takesNoValue,
	sample: {
		id: "ticket",
		type: "tool",
		position: { x: 0, y: 0 },
		connection: "jira",
		tool: "getIssue",
		arguments: { key: "{{issue}}" },
	},
} satisfies NodeDefinition<ToolNode, z.input<typeof toolNodeSchema>>;
