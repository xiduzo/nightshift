import { z } from "zod";
import {
	checkNodeProfile,
	type DeciderName,
	deciderNameSchema,
	labelSchema,
	type NodeCheck,
	nodeBase,
	nodeProfileSchema,
	placed,
} from "./base";
import { checkOptions, option } from "./outcomes";

/**
 * The Decision node: it picks one of its options, decided by a person (a
 * Gate), a rule or a model.
 */

/** Who decides a Decision node: you (a Gate), a rule, or a model. */
export const decidedBySchema = z.enum(["person", "rule", "model"]);
export type DecidedBy = z.infer<typeof decidedBySchema>;

/**
 * When a Gate stops waiting, in the same forms as a Wait node: `at`, a
 * template that renders a date and time (`2026-10-18T07:00`) or a time of
 * day (`07:00`: the next one after the Gate opens), or `minutes` after the
 * Gate opens. Exactly one of the two (the validator checks it). `choose`
 * names the option the Gate takes then.
 */
export const gateDeadlineSchema = z.object({
	at: z.string().optional(),
	minutes: z.number().int().positive().optional(),
	choose: labelSchema,
});
export type GateDeadline = z.infer<typeof gateDeadlineSchema>;

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
	/**
	 * `by: "model"` only: a Model Profile of one Device, by the Device's id
	 * and the profile's id, that names the decider and its model. The
	 * node's own `decider` and `model` win over it. A run resolves it when
	 * it starts.
	 */
	profile: nodeProfileSchema.optional(),
	/**
	 * `by: "model"` only: the decision model that picks. Unset: the
	 * profile's, else TypeSafe (`decisionDecider`). A Decision by a person
	 * or a rule has none.
	 */
	decider: deciderNameSchema.optional(),
	/** `by: "model"` only. The decider's model. Unset: the decider's default (`jev-latest` for TypeSafe). */
	model: z.string().min(1).optional(),
	/**
	 * `by: "person"` only, with exactly two options: this Gate can be
	 * answered from the lock screen. Its notification on a phone shows
	 * Approve (the first option) and Reject (the second). Without it
	 * (the default), the notification opens the app, which checks it is you
	 * before the answer goes. An optional field: older files read as false,
	 * so the flow version stays the same.
	 */
	lockScreen: z.boolean().optional(),
	/**
	 * `by: "person"` only: when nobody answered by then, the Gate takes
	 * `choose`, and its note says the deadline chose it. Unset: the Gate
	 * waits as long as it must.
	 */
	deadline: gateDeadlineSchema.optional(),
});
export type DecisionNode = z.infer<typeof decisionNodeSchema>;

/** The decider of a Decision by model: its own, else TypeSafe. */
export function decisionDecider(
	node: Pick<DecisionNode, "decider">,
): DeciderName {
	return node.decider ?? "typesafe";
}

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
	checkDeadline(node, check);
	if (node.profile !== undefined && node.by !== "model") {
		check.error(
			`Decision node "${node.id}" names a profile, but ${node.by === "person" ? "you decide" : "a rule decides"} it. Only a model reads a profile. Remove the profile, or let a model decide.`,
		);
	} else {
		checkNodeProfile(node, "Decision", check);
	}
	check.template(node.prompt, "prompt");
}

/**
 * A deadline belongs to a Gate (a Decision decided by a person), has one
 * time (`at` or `minutes`), and chooses one of the Gate's options.
 */
function checkDeadline(node: DecisionNode, check: NodeCheck): void {
	const deadline = node.deadline;
	if (deadline === undefined) return;
	if (node.by !== "person") {
		check.error(
			`Decision node "${node.id}" has a deadline, but ${node.by === "rule" ? "a rule" : "a model"} decides it. Only a Gate waits for an answer. Remove the deadline, or let a person decide.`,
		);
		return;
	}
	const at = deadline.at?.trim() ?? "";
	if ((at === "") === (deadline.minutes === undefined)) {
		check.error(
			`The deadline of Gate "${node.id}" needs a time or a number of minutes. Give it one of the two.`,
		);
	}
	if (at !== "") check.template(at, "deadline");
	if (!node.options.some((option) => option.name === deadline.choose)) {
		check.error(
			`The deadline of Gate "${node.id}" chooses "${deadline.choose}", which is not one of its options. Choose one of: ${node.options.map((option) => option.name).join(", ")}.`,
		);
	}
}

/**
 * A Decision decided by a person or a model needs a prompt. Rules (`when`)
 * belong to a Decision decided by a rule, where every option but the last
 * has one: the first rule that holds picks its option, and the option
 * without a rule is the default. A rule must parse, and the names it reads
 * must be inputs or nodes of the flow. Only a Gate with two options can
 * be answered from the lock screen (`lockScreen`): Approve answers the
 * first, Reject the second.
 */
function checkDecidedBy(node: DecisionNode, check: NodeCheck): void {
	const ruled = node.options.filter(
		(option) => option.when !== undefined && option.when.trim() !== "",
	);
	if (node.lockScreen === true && node.by !== "person") {
		check.error(
			`Decision node "${node.id}" is decided by ${node.by === "rule" ? "a rule" : "a model"}. Only a person can answer from the lock screen. Turn off "Can be answered from the lock screen", or let a person decide.`,
		);
	} else if (node.lockScreen === true && node.options.length !== 2) {
		// The phone's buttons have fixed titles: Approve, Reject.
		check.error(
			`Decision node "${node.id}" can be answered from the lock screen, but it has ${node.options.length} ${node.options.length === 1 ? "option" : "options"}. The lock screen shows Approve for the first option and Reject for the second. Give it two options, or turn off "Can be answered from the lock screen".`,
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
