import { z } from "zod";
import { deciderNameSchema, type NodeCheck, nodeBase, placed } from "./common";
import { checkOptions, option } from "./outcomes";

/**
 * The Decision node: it picks one of its options, decided by a person (a
 * Gate), a rule or a model.
 */

/** Who decides a Decision node: you (a Gate), a rule, or a model. */
export const decidedBySchema = z.enum(["person", "rule", "model"]);
export type DecidedBy = z.infer<typeof decidedBySchema>;

/**
 * Picks one of its options, which is the step's outcome. `by` says who:
 * `person` (a Gate: the question waits in the Needs-you inbox), `rule`
 * (the first option whose `when` holds, no cost), or `model` (a small
 * model reads the prompt and picks).
 */
export const decisionNodeSchema = z.object({
	...nodeBase,
	/** `by: "model"` only: where the model is asked. */
	...placed,
	type: z.literal("decision"),
	/**
	 * The question for a person, the brief for a model, or a note on what
	 * the rule checks. Supports templates.
	 */
	prompt: z.string(),
	/** The options to pick from. Each one is an outcome, with its own edge. */
	options: z.array(option).min(1),
	by: decidedBySchema,
	/** `by: "model"` only: the decision model that picks. */
	decider: deciderNameSchema.default("typesafe"),
	/** `by: "model"` only. The decider's model. Unset: the decider's default (`jev-latest` for TypeSafe). */
	model: z.string().min(1).optional(),
	/**
	 * `by: "person"` only: this Gate can be answered from the lock screen.
	 * Its notification on a phone shows the options as buttons. Without it
	 * (the default), the notification opens the app, which checks it is you
	 * before the answer goes. An optional field: older files read as false,
	 * so the flow version stays the same.
	 */
	lockScreen: z.boolean().optional(),
});
export type DecisionNode = z.infer<typeof decisionNodeSchema>;

/** outcome: the option. note: what the person wrote, or why the model picked it. */
export const decisionOutputFields = ["outcome", "note", "visit"] as const;

/** Who picks a Decision's option, for the warning on an option without an edge. */
const pickerWords: Record<DecisionNode["by"], string> = {
	person: "you pick",
	rule: "the rule picks",
	model: "the model picks",
};

/**
 * A Decision node's options follow the outcome rules (`checkOptions`), its
 * rules or prompt fit who decides it, and its prompt reads known names.
 */
export function checkDecisionNode(node: DecisionNode, check: NodeCheck): void {
	checkOptions(
		node.id,
		node.options.map((option) => option.name),
		{ title: "Decision", kind: "option", picker: pickerWords[node.by] },
		() => false,
		check,
	);
	checkDecidedBy(node, check);
	check.template(node.prompt, "prompt");
}

/**
 * A Decision decided by a person or a model needs a prompt. Rules (`when`)
 * belong to a Decision decided by a rule, where every option but the last
 * has one: the first rule that holds picks its option, and the option
 * without a rule is the default. A rule must parse, and the names it reads
 * must be inputs or nodes of the flow. Only a Gate can be answered from
 * the lock screen (`lockScreen`).
 */
function checkDecidedBy(node: DecisionNode, check: NodeCheck): void {
	const ruled = node.options.filter(
		(option) => option.when !== undefined && option.when.trim() !== "",
	);
	if (node.lockScreen === true && node.by !== "person") {
		check.error(
			`Decision node "${node.id}" can be answered from the lock screen, but ${node.by === "rule" ? "a rule" : "a model"} decides it. Remove lockScreen, or decide it yourself.`,
		);
	}
	if (node.by !== "rule") {
		if (node.prompt.trim() === "") {
			check.error(
				node.by === "person"
					? `Decision node "${node.id}" needs a question for you to answer.`
					: `Decision node "${node.id}" needs a prompt for the model.`,
			);
		}
		if (ruled.length > 0) {
			check.error(
				`Decision node "${node.id}" has a rule on "${ruled[0]?.name}", but ${node.by === "person" ? "you decide" : "a model decides"} it. Remove the rule, or let a rule decide.`,
			);
		}
		return;
	}
	const defaults = node.options.filter((option) => !ruled.includes(option));
	if (defaults.length > 1) {
		check.error(
			`Decision node "${node.id}" has ${defaults.length} options without a rule (${defaults.map((o) => `"${o.name}"`).join(", ")}). Give all but one a rule: the one without is the default.`,
		);
	} else if (defaults.length === 1 && node.options.at(-1) !== defaults[0]) {
		check.warning(
			`Decision node "${node.id}": the option "${defaults[0]?.name}" has no rule, so it always matches. Put it last, or the options after it are never picked.`,
		);
	}
	for (const option of ruled) {
		check.rule(
			option.when ?? "",
			`The rule of option "${option.name}" of "${node.id}"`,
		);
	}
}
