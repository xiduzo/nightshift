import { z } from "zod";
import {
	type AttachmentSource,
	attachmentSourceSchema,
	choicesFieldProblem,
	formDataProblem,
} from "./ask";
import {
	checkModelAddress,
	checkNodeProfile,
	type DeciderName,
	deciderNameSchema,
	isObjectSchema,
	jsonSchemaSchema,
	type ModelAddress,
	modelAddressSchema,
	type NodeCheck,
	type NodeProfile,
	nodeBase,
	nodeProfileSchema,
	placed,
} from "./base";
import {
	checkCascade,
	checkModelTier,
	isPersonTier,
	personTierSchema,
	tierBase,
	tierLabel,
} from "./cascade";

/** The Value node: it makes `data` that matches its output schema, by a rule, a model or a person. */

/**
 * The deciders that can also make a value (a Value node made by a model):
 * those with a TanStack AI text adapter, so `chat()` can hold their answer
 * to a JSON Schema: OpenRouter, OpenAI, Ollama and an OpenAI-compatible
 * server. TypeSafe, Ollaya and OpenJev are decision models only: they
 * answer choice, score and yes/no questions, never with data. The first is
 * the default for a new Value node.
 */
export const valueDeciderNameSchema = z.enum([
	"openrouter",
	"openai",
	"ollama",
	"compatible",
]);
export type ValueDeciderName = z.infer<typeof valueDeciderNameSchema>;

/** Whether the decider can make a value. */
export function canMakeValue(name: DeciderName): name is ValueDeciderName {
	return valueDeciderNameSchema.safeParse(name).success;
}

/**
 * Who makes a Value node's data: a rule (a JSONata expression), a model
 * (a decider that can make a value), or a person (an Ask, ADR 10: a form
 * in the Needs-you inbox, drawn from the output schema).
 */
export const valueBySchema = z.enum(["rule", "model", "person"]);
export type ValueBy = z.infer<typeof valueBySchema>;

/**
 * A tier of a Value's cascade (ADR 6): a Model Profile, or its own decider
 * and model, and an `accept` rule. A try holds when the data matches the
 * output schema and the rule holds. A run copies the profile's address
 * onto the tier, as onto a node.
 */
/** A tier of a Value's cascade. Named, so the declared types stay small. */
export interface ValueTier {
	label?: string;
	tries?: number;
	profile?: NodeProfile;
	decider?: DeciderName;
	model?: string;
	address?: ModelAddress;
	accept?: string;
}

export const valueTierSchema: z.ZodType<ValueTier> = z.object({
	...tierBase,
	profile: nodeProfileSchema.optional(),
	decider: deciderNameSchema.optional(),
	model: z.string().min(1).optional(),
	address: modelAddressSchema.optional(),
	/** A JSONata rule over the value as `data`: `$count(data.tasks) > 0`. Unset: data that matches holds. */
	accept: z.string().optional(),
});

/**
 * `by: "person"` only: the choices come from the run. `from` is a template
 * that renders a list of `{ name, label, description?, attachments? }`.
 * The engine sets the names as the `enum` of the output field `field`: a
 * string field is one choice, an array of strings a choice of several.
 */
export interface AskChoicesSource {
	from: string;
	field: string;
}

export const askChoicesSourceSchema: z.ZodType<AskChoicesSource> = z.object({
	from: z.string().min(1),
	field: z.string().min(1),
});

/**
 * `by: "person"` only: when the Ask stops waiting. `minutes` from when it
 * opens, or `at` (a time a Wait by time reads; templates allowed). The
 * node's `default` is the data then.
 */
export interface AskDeadline {
	at?: string;
	minutes?: number;
}

export const askDeadlineSchema: z.ZodType<AskDeadline> = z.object({
	at: z.string().optional(),
	minutes: z.number().int().positive().optional(),
});

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
	/**
	 * `by: "model"`: the brief for the model. `by: "person"`: the question
	 * above the form. Supports templates.
	 */
	prompt: z.string().optional(),
	/** `by: "person"` only: choices from the run (`AskChoicesSource`). */
	choices: askChoicesSourceSchema.optional(),
	/** `by: "person"` only: files of the run's copy of the project, or links, that the Ask shows. */
	attachments: z.array(attachmentSourceSchema).max(20).optional(),
	/** `by: "person"` only: when the Ask stops waiting and takes `default`. */
	deadline: askDeadlineSchema.optional(),
	/** `by: "person"` only: the data the Ask takes at its deadline. It must match the output schema. */
	default: z.json().optional(),
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
	/**
	 * `by: "model"` only: the tiers a model climbs (ADR 6). It replaces the
	 * node's `profile`, `decider` and `model`. The step ends `fail` when
	 * the last tier does not hold. A person tier (an Ask, ADR 10) is not
	 * there yet: the checks refuse one.
	 */
	cascade: z
		.array(z.union([personTierSchema, valueTierSchema]))
		.min(1)
		.max(8)
		.optional(),
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
	checkAsk(node, check);
	checkModelAddress(node, "Value", check);
	checkValueCascade(node, check);
	if (node.prompt !== undefined) check.template(node.prompt, "prompt");
}

/**
 * A Value's cascade belongs to a model and replaces its profile, decider
 * and model. Each tier's decider must make a value, and its `accept` rule
 * reads only `data`. No person tier yet (ADR 10): `checkCascade` refuses it.
 */
function checkValueCascade(node: ValueNode, check: NodeCheck): void {
	const tiers = node.cascade;
	if (tiers === undefined) return;
	if (node.by !== "model") {
		check.error(
			`Value node "${node.id}" has a cascade, but ${node.by === "rule" ? "a rule" : "a person"} makes it. Only a model climbs a cascade. Remove the cascade, or let a model make it.`,
		);
		return;
	}
	const replaced = [
		node.profile !== undefined ? "a profile" : null,
		node.decider !== undefined ? "a decider" : null,
		node.model !== undefined ? "a model" : null,
	].filter((name) => name !== null);
	if (replaced.length > 0) {
		check.error(
			`Value node "${node.id}" has a cascade and ${replaced.join(" and ")}. The tiers of the cascade name the models. Remove ${replaced.length === 1 ? "it" : "them"} from the node.`,
		);
	}
	checkCascade(node, { title: "Value", personChoices: null }, check);
	tiers.forEach((tier, index) => {
		if (isPersonTier(tier)) return;
		const label = tierLabel(tier, index);
		checkModelTier(node.id, tier, label, "Value", check);
		const decider =
			tier.decider ?? (tier.profile === undefined ? "openrouter" : undefined);
		if (decider !== undefined && !canMakeValue(decider)) {
			check.error(
				`The tier "${label}" of Value node "${node.id}" uses the decider "${decider}", which cannot make a value. Choose one of: ${valueDeciderNameSchema.options.join(", ")}.`,
			);
		}
		if (tier.accept !== undefined && tier.accept.trim() !== "") {
			check.dataRule(
				tier.accept,
				`The accept rule of the tier "${label}" of "${node.id}"`,
			);
		}
	});
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
		// A profile gives the decider when the node names none; a cascade's
		// tiers give it then (`checkValueCascade`).
		const fromProfile =
			(node.profile !== undefined || node.cascade !== undefined) &&
			node.decider === undefined;
		checkNodeProfile(node, "Value", check);
		if (!fromProfile && !canMakeValue(decider)) {
			check.error(
				`Value node "${node.id}" uses the decider "${decider}", which cannot make a value. Choose one of: ${valueDeciderNameSchema.options.join(", ")}.`,
			);
		}
		return;
	}
	if (node.by === "person") {
		if (node.prompt === undefined || node.prompt.trim() === "") {
			check.error(
				`Value node "${node.id}" needs a prompt: the question the person answers.`,
			);
		}
		const modelFields = [
			node.profile !== undefined ? "a profile" : null,
			node.decider !== undefined ? "a decider" : null,
			node.model !== undefined ? "a model" : null,
		].filter((name) => name !== null);
		if (modelFields.length > 0) {
			check.error(
				`Value node "${node.id}" names ${modelFields.join(" and ")}, but a person makes it. Only a model reads ${modelFields.length === 1 ? "it" : "them"}. Remove ${modelFields.length === 1 ? "it" : "them"}, or let a model make it.`,
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

/** The fields only an Ask reads. */
const ASK_FIELDS = ["choices", "attachments", "deadline", "default"] as const;

/**
 * An Ask (a Value by a person, ADR 10): its choices name an output field
 * that is a string or an array of strings, its templates read known
 * names, its attachments are a file or a link, its deadline has one time
 * and a default, and the default fits the form. Another maker reads none
 * of these fields.
 */
function checkAsk(node: ValueNode, check: NodeCheck): void {
	if (node.by !== "person") {
		const set = ASK_FIELDS.filter((field) => node[field] !== undefined);
		if (set.length > 0) {
			check.error(
				`Value node "${node.id}" sets ${set.join(", ")}, but only a person reads ${set.length === 1 ? "it" : "them"}. Remove ${set.length === 1 ? "it" : "them"}, or let a person make it.`,
			);
		}
		return;
	}
	const { choices } = node;
	if (choices !== undefined) {
		check.template(choices.from, "choices");
		const problem = choicesFieldProblem(node.output, choices.field);
		if (problem === "missing") {
			check.error(
				`The choices of Value node "${node.id}" go to the field "${choices.field}", which the output schema does not have. Add it to the output schema, or name another field.`,
			);
		} else if (problem === "type") {
			check.error(
				`The choices of Value node "${node.id}" go to the field "${choices.field}", which is not text or a list of text. Give it "type": "string", or "type": "array" with string items.`,
			);
		}
	}
	(node.attachments ?? []).forEach((attachment, index) => {
		checkAttachment(node.id, attachment, index, check);
	});
	checkAskDeadline(node, check);
}

/** An attachment is one file or one link, and its templates read known names. */
function checkAttachment(
	nodeId: string,
	attachment: AttachmentSource,
	index: number,
	check: NodeCheck,
): void {
	const path = attachment.path?.trim() ?? "";
	const url = attachment.url?.trim() ?? "";
	if ((path === "") === (url === "")) {
		check.error(
			`Attachment ${index + 1} of Value node "${nodeId}" needs a file path or a link. Give it one of the two.`,
		);
		return;
	}
	if (path !== "") check.template(path, "attachment path");
	if (url !== "") check.template(url, "attachment link");
}

/**
 * A deadline has a time or minutes, and a default: the data the Ask takes
 * then. The default fits the form. A default with no deadline is never
 * taken.
 */
function checkAskDeadline(node: ValueNode, check: NodeCheck): void {
	const { deadline } = node;
	if (deadline === undefined) {
		if (node.default !== undefined) {
			check.warning(
				`Value node "${node.id}" has a default but no deadline, so it never takes the default. Add a deadline, or remove the default.`,
			);
		}
		return;
	}
	const at = deadline.at?.trim() ?? "";
	if ((at === "") === (deadline.minutes === undefined)) {
		check.error(
			`The deadline of Value node "${node.id}" needs a time or a number of minutes. Give it one of the two.`,
		);
	}
	if (at !== "") check.template(at, "deadline");
	if (node.default === undefined) {
		check.error(
			`Value node "${node.id}" has a deadline but no default. Give it the data it takes when nobody answers.`,
		);
		return;
	}
	const problem = formDataProblem(node.output, node.default);
	if (problem !== null) {
		check.error(
			`The default of Value node "${node.id}" does not match the output schema: ${problem}`,
		);
	}
}
