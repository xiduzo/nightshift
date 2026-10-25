import { z } from "zod";
import { type NodeCheck, nameSchema, nodeBase, placed } from "./base";

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
