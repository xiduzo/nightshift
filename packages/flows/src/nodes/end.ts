import { z } from "zod";
import { type NodeCheck, nodeBase } from "./base";

/** The End node: it ends the run on purpose, with a result and one line of text. */

/**
 * How an End node ends the run. `done`: the run did its work. `nothing-to-do`:
 * the run found no work, which is not a failure. `failed`: the flow chose to
 * fail, so a person looks at it.
 */
export const endStatusSchema = z.enum(["done", "nothing-to-do", "failed"]);
export type EndStatus = z.infer<typeof endStatusSchema>;

/**
 * Ends the run with `status` and `message`, a template rendered to one line
 * ("No open issues"). The runs list, the run page and the notification show
 * both. No edge leaves it: its step ends with the status as its outcome, and
 * the run ends there.
 *
 * In a called flow it ends the called flow: `done` and `nothing-to-do` end
 * the Call `pass`, `failed` ends it `fail`. The Call's `ended` holds the
 * status and its `end_message` the message.
 */
export const endNodeSchema = z.object({
	...nodeBase,
	type: z.literal("end"),
	status: endStatusSchema,
	/** One line for a person. A template. */
	message: z.string().optional(),
});
export type EndNode = z.infer<typeof endNodeSchema>;

/** message: the rendered message, on one line. */
export const endOutputFields = ["outcome", "message", "visit"] as const;

/**
 * The message an End node gives, from its rendered template: the first
 * line that is not blank, trimmed. Null when there is none.
 */
export function endMessage(rendered: string): string | null {
	const line = rendered
		.split("\n")
		.map((text) => text.trim())
		.find((text) => text !== "");
	return line ?? null;
}

/**
 * An End node's message reads known names. That no edge leaves it is a
 * check of the flow's edges (`validateFlow`).
 */
export function checkEndNode(node: EndNode, check: NodeCheck): void {
	if (node.message !== undefined) check.template(node.message, "message");
}
