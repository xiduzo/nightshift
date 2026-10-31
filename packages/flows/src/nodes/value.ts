import { z } from "zod";
import {
	checkModelAddress,
	checkNodeProfile,
	type DeciderName,
	deciderNameSchema,
	isObjectSchema,
	jsonSchemaSchema,
	modelAddressSchema,
	type NodeCheck,
	nodeBase,
	nodeProfileSchema,
	placed,
} from "./base";

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
	/**
	 * `by: "model"` only: a Model Profile of one Device, by the Device's id
	 * and the profile's id, that names the decider and its model. Its
	 * decider must make values. The node's own `decider` and `model` win
	 * over it. A run resolves it when it starts.
	 */
	profile: nodeProfileSchema.optional(),
	/**
	 * `by: "model"` only: a decider that can make a value
	 * (`valueDeciderNameSchema`). Unset: the profile's, else OpenRouter
	 * (`valueDecider`). A Value by a rule has none.
	 */
	decider: deciderNameSchema.optional(),
	/** `by: "model"` only. The decider's model. Unset: the decider's default chat model. */
	model: z.string().min(1).optional(),
	/**
	 * `by: "model"` only: where the decider finds its server. A run copies
	 * it from the Model Profile (ADR 5), so the run's copy of the flow has
	 * it. A flow does not set it: validation refuses one.
	 */
	address: modelAddressSchema.optional(),
});
export type ValueNode = z.infer<typeof valueNodeSchema>;

/** The decider of a Value by model: its own, else OpenRouter. */
export function valueDecider(node: Pick<ValueNode, "decider">): DeciderName {
	return node.decider ?? "openrouter";
}

/** data: the value made (null on fail). note: why it failed, or the model's note. */
export const valueOutputFields = ["outcome", "data", "note", "visit"] as const;

/** A Value node's maker fits `by` (`checkMaker`), and its prompt reads known names. */
export function checkValueNode(node: ValueNode, check: NodeCheck): void {
	checkMaker(node, check);
	checkModelAddress(node, "Value", check);
	if (node.prompt !== undefined) check.template(node.prompt, "prompt");
}

/**
 * A Value node's output schema must describe an object. Made by a rule, it
 * needs an expression that parses and reads only inputs or nodes of the
 * flow. Made by a model, it needs a prompt and a decider that can make a
 * value (one with a text adapter: TypeSafe and Ollaya only decide). A
 * profile's decider is checked when a run resolves it. Only a model reads
 * a profile.
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
		const decider = valueDecider(node);
		// A profile gives the decider when the node names none.
		const fromProfile =
			node.profile !== undefined && node.decider === undefined;
		checkNodeProfile(node, "Value", check);
		if (!fromProfile && !canMakeValue(decider)) {
			check.error(
				`Value node "${node.id}" uses the decider "${decider}", which cannot make a value. Choose one of: ${valueDeciderNameSchema.options.join(", ")}.`,
			);
		}
		return;
	}
	if (node.profile !== undefined) {
		check.error(
			`Value node "${node.id}" names a profile, but a rule makes it. Only a model reads a profile. Remove the profile, or let a model make it.`,
		);
	}
	const expression = node.expression ?? "";
	if (expression.trim() === "") {
		check.error(`Value node "${node.id}" needs an expression.`);
		return;
	}
	check.rule(expression, `The expression of "${node.id}"`);
}
