import { z } from "zod";
import {
	type DeciderName,
	deciderNameSchema,
	isObjectSchema,
	jsonSchemaSchema,
	type NodeCheck,
	nodeBase,
	placed,
} from "./common";

/** The Value node: it makes `data` that matches its output schema, by a rule or a model. */

/**
 * The deciders that can also make a value (a Value node made by a model):
 * those with a TanStack AI text adapter, so `chat()` can hold their answer
 * to a JSON Schema: OpenRouter, OpenAI and Ollama. TypeSafe and Ollaya are
 * decision models only: they answer choice, score and yes/no questions,
 * never with data. The first is the default for a new Value node.
 */
export const valueDeciderNameSchema = z.enum([
	"openrouter",
	"openai",
	"ollama",
]);
export type ValueDeciderName = z.infer<typeof valueDeciderNameSchema>;

/** Whether the decider can make a value. */
export function canMakeValue(name: DeciderName): name is ValueDeciderName {
	return valueDeciderNameSchema.safeParse(name).success;
}

/**
 * Who makes a Value node's data: a rule (a JSONata expression) or a model
 * (a decider that can make a value). `person` (a form in the Needs-you
 * inbox, drawn from the output schema) is left for later: add it here and
 * a producer in the engine when a flow needs typed answers.
 */
export const valueBySchema = z.enum(["rule", "model"]);
export type ValueBy = z.infer<typeof valueBySchema>;

/**
 * The twin of a Decision: a Decision picks a label, a Value makes `data`
 * that matches `output`, and `by` says who. `pass` when the data matches,
 * `fail` when the expression throws, the model fails, or the result does not
 * match. Later nodes read `{{<node>.data}}` or a path into it.
 */
export const valueNodeSchema = z.object({
	...nodeBase,
	/** `by: "model"` only: where the model is asked. */
	...placed,
	type: z.literal("value"),
	by: valueBySchema,
	/** A JSON Schema for `data`. The step passes only with data that matches it. */
	output: jsonSchemaSchema,
	/**
	 * `by: "rule"` only: a JSONata expression over the run's values, the same
	 * context a Decision's rule reads (`ruleContext`), for example
	 * `$filter(planner.data.tasks, function($t) { $t.size = "small" })`.
	 */
	expression: z.string().optional(),
	/** `by: "model"` only: the brief for the model. Supports templates. */
	prompt: z.string().optional(),
	/** `by: "model"` only: a decider that can make a value (`valueDeciderNameSchema`). */
	decider: deciderNameSchema.default("openrouter"),
	/** `by: "model"` only. The decider's model. Unset: the decider's default chat model. */
	model: z.string().min(1).optional(),
});
export type ValueNode = z.infer<typeof valueNodeSchema>;

/** data: the value made (null on fail). note: why it failed, or the model's note. */
export const valueOutputFields = ["outcome", "data", "note", "visit"] as const;

/** A Value node's maker fits `by` (`checkMaker`), and its prompt reads known names. */
export function checkValueNode(node: ValueNode, check: NodeCheck): void {
	checkMaker(node, check);
	if (node.prompt !== undefined) check.template(node.prompt, "prompt");
}

/**
 * A Value node's output schema must describe an object. Made by a rule, it
 * needs an expression that parses and reads only inputs or nodes of the
 * flow. Made by a model, it needs a prompt and a decider that can make a
 * value (one with a text adapter: TypeSafe and Ollaya only decide).
 */
function checkMaker(node: ValueNode, check: NodeCheck): void {
	if (!isObjectSchema(node.output)) {
		check.error(
			`The output schema of value node "${node.id}" must describe an object: give it "type": "object" or "properties".`,
		);
	}
	if (node.by === "model") {
		if (node.prompt === undefined || node.prompt.trim() === "") {
			check.error(`Value node "${node.id}" needs a prompt for the model.`);
		}
		if (!canMakeValue(node.decider)) {
			check.error(
				`Value node "${node.id}" uses the decider "${node.decider}", which cannot make a value. Choose one of: ${valueDeciderNameSchema.options.join(", ")}.`,
			);
		}
		return;
	}
	const expression = node.expression ?? "";
	if (expression.trim() === "") {
		check.error(`Value node "${node.id}" needs an expression.`);
		return;
	}
	check.rule(expression, `The expression of "${node.id}"`);
}
