import { z } from "zod";
import {
	checkModelAddress,
	checkNodeProfile,
	type DeciderName,
	deciderNameSchema,
	modelAddressSchema,
	type NodeCheck,
	nodeBase,
	nodeProfileSchema,
	placed,
} from "./base";
import {
	checkCascade,
	checkModelTier,
	gateDeadlineSchema,
	isPersonTier,
	personTierSchema,
	probabilityProblem,
	tierBase,
	tierLabel,
} from "./cascade";
import { checkOptions, option } from "./outcomes";

/**
 * The Decision node: it picks one of its options, decided by a person (a
 * Gate), a rule or a model.
 */

/** Who decides a Decision node: you (a Gate), a rule, or a model. */
export const decidedBySchema = z.enum(["person", "rule", "model"]);
export type DecidedBy = z.infer<typeof decidedBySchema>;

/**
 * A tier of a Decision's cascade (ADR 6): a Model Profile, or its own
 * decider and model, and the probability its pick needs to hold. Without
 * `minConfidence` every pick holds. A run copies the profile's address
 * onto the tier, as onto a node.
 */
export const decisionTierSchema = z.object({
	...tierBase,
	profile: nodeProfileSchema.optional(),
	decider: deciderNameSchema.optional(),
	model: z.string().min(1).optional(),
	address: modelAddressSchema.optional(),
	/** The least probability, from 0 to 1, the pick needs. Unset: every pick holds. */
	minConfidence: z.number().min(0).max(1).optional(),
});
export type DecisionTier = z.infer<typeof decisionTierSchema>;

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
	 * `by: "model"` only: where the decider finds its server. A run copies
	 * it from the Model Profile (ADR 5), so the run's copy of the flow has
	 * it. A flow does not set it: validation refuses one.
	 */
	address: modelAddressSchema.optional(),
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
	/**
	 * `by: "model"` only: the tiers a model climbs (ADR 6). The first tier
	 * picks; a pick below its `minConfidence` goes to the next tier. The
	 * last tier can be a person: a Gate that shows each tier's pick. It
	 * replaces the node's `profile`, `decider` and `model`. Without a
	 * person tier, the step ends `fail` when the last tier does not hold.
	 */
	cascade: z
		.array(z.union([personTierSchema, decisionTierSchema]))
		.min(1)
		.max(8)
		.optional(),
});
export type DecisionNode = z.infer<typeof decisionNodeSchema>;

/** The decider of a Decision by model: its own, else TypeSafe. */
export function decisionDecider(
	node: Pick<DecisionNode, "decider">,
): DeciderName {
	return node.decider ?? "typesafe";
}

/**
 * outcome: the option. note: what the person wrote, or why the model
 * picked it. With a cascade also `tier`, `tries` and `confidence`.
 */
export const decisionOutputFields = ["outcome", "note", "visit"] as const;

/** The probability of the pick that held, a field of a Decision with a cascade. */
export const confidenceField = "confidence";

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
	checkDecisionCascade(node, check);
	checkModelAddress(node, "Decision", check);
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
 * A Decision's cascade belongs to a model, replaces its profile, decider
 * and model, and its tiers follow the model tier checks. A decider without
 * a probability is the last model tier only. No option may be named
 * `fail`: a cascade that does not hold ends there.
 */
function checkDecisionCascade(node: DecisionNode, check: NodeCheck): void {
	const tiers = node.cascade;
	if (tiers === undefined) return;
	if (node.by !== "model") {
		check.error(
			`Decision node "${node.id}" has a cascade, but ${node.by === "person" ? "you decide" : "a rule decides"} it. Only a model climbs a cascade. Remove the cascade, or let a model decide.`,
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
			`Decision node "${node.id}" has a cascade and ${replaced.join(" and ")}. The tiers of the cascade name the models. Remove ${replaced.length === 1 ? "it" : "them"} from the node.`,
		);
	}
	if (node.options.some((option) => option.name === "fail")) {
		check.error(
			`Decision node "${node.id}" has a cascade and an option named "fail". A cascade that does not hold ends on fail. Rename the option.`,
		);
	}
	const options = node.options.map((option) => option.name);
	checkCascade(node, { title: "Decision", personChoices: options }, check);
	const lastModel = tiers.findLastIndex((tier) => !isPersonTier(tier));
	tiers.forEach((tier, index) => {
		if (isPersonTier(tier)) return;
		const label = tierLabel(tier, index);
		checkModelTier(node.id, tier, label, "Decision", check);
		const problem = probabilityProblem({
			nodeId: node.id,
			label,
			decider:
				tier.decider ?? (tier.profile === undefined ? "typesafe" : undefined),
			minConfidence: tier.minConfidence,
			lastModelTier: index === lastModel,
		});
		if (problem !== null) check.error(problem);
	});
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
			`${node.by === "rule" ? "A rule" : "A model"} decides Decision node "${node.id}". Only a person can answer from the lock screen. Turn off "Can be answered from the lock screen", or let a person decide.`,
		);
	} else if (node.lockScreen === true && node.options.length !== 2) {
		// The phone's buttons have fixed titles: Approve, Reject.
		check.error(
			`You can answer Decision node "${node.id}" from the lock screen, but it has ${node.options.length} ${node.options.length === 1 ? "option" : "options"}. The lock screen shows only Approve and Reject, for the first and the second option. Give it two options, or turn off "Can be answered from the lock screen".`,
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
			`Decision node "${node.id}": the option "${defaults[0]?.name}" has no rule, so it always matches. Put it last, or the run never picks the options after it.`,
		);
	}
	for (const option of ruled) {
		check.rule(
			option.when ?? "",
			`The rule of option "${option.name}" of "${node.id}"`,
		);
	}
}
