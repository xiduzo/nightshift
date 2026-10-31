import { z } from "zod";
import {
	type DeciderName,
	deciderAddress,
	deciderMeasuresProbability,
	isProfileRef,
	labelSchema,
	type ModelAddress,
	type NodeCheck,
	type NodeProfile,
} from "./base";

/**
 * A cascade (ADR 6): a list of tiers on an Agent, a Decision or a Value
 * decided by a model, or a Call. The engine tries the first tier. A try
 * that does not hold is tried again in the same tier, up to `tries`, and
 * then on the next tier. The last tier can be a person. Each node file
 * says what its tiers name; this file holds what they share.
 */

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

/** What every model tier shares: its name on the run page, and how often it is tried. */
export const tierBase = {
	/** The tier's name on the run page and in `{{cascade.tier}}`. Unset: its number. */
	label: z.string().trim().min(1).max(40).optional(),
	/** How often the tier is tried before the next one. Unset: once. */
	tries: z.number().int().min(1).max(10).optional(),
};

/**
 * The last tier can be a person: a Gate. A Decision's shows each tier's
 * pick and probability, and the person picks an option. An Agent's or a
 * Call's offers "try-again" (one more try on the last tier, with the
 * person's note) and "stop". A deadline chooses for nobody, as on a Gate.
 */
/** The last tier of a cascade as a person. Named, so the declared types stay small. */
export interface PersonTier {
	person: true;
	label?: string;
	deadline?: GateDeadline;
}

export const personTierSchema: z.ZodType<PersonTier> = z.object({
	person: z.literal(true),
	label: tierBase.label,
	deadline: gateDeadlineSchema.optional(),
});

/** The choices of the person tier of an Agent or a Call. */
export const RETRY_CHOICES = ["try-again", "stop"] as const;

/**
 * What the deadline of a Value's person tier (an Ask, ADR 10) may take:
 * `accept` takes the best answer of the models when it matches the
 * schema, `fail` ends the step `fail`.
 */
export const ASK_TIER_CHOICES = ["accept", "fail"] as const;

/** The tier is a person, not a model, an agent or a flow. */
export function isPersonTier<T extends object>(
	tier: T | PersonTier,
): tier is PersonTier {
	return "person" in tier && tier.person === true;
}

/** A tier's name: its label, else "person" or its number from 1. */
export function tierLabel(
	tier: { label?: string; person?: true },
	index: number,
): string {
	return tier.label ?? (tier.person === true ? "person" : String(index + 1));
}

/** The fields `{{cascade.<field>}}` reads in a node with a cascade. */
export const CASCADE_TEMPLATE_FIELDS = ["tier", "try", "previous"] as const;

/** The output fields a cascade adds to its node's step: the tier that held and the tries. */
export const cascadeOutputFields = ["tier", "tries"] as const;

/** How the checks of a cascade name the node and its person tier. */
export type CascadeWords = {
	/** "Agent". */
	title: string;
	/**
	 * What a person tier's deadline may choose: the Decision's options,
	 * the retry choices of an Agent or a Call, or what a Value's Ask takes.
	 */
	personChoices: readonly string[];
};

/**
 * The checks every cascade shares: unique tier names, at most one person
 * tier and only last, and a person tier's deadline.
 */
export function checkCascade(
	node: { id: string; cascade?: readonly ({ label?: string } | PersonTier)[] },
	words: CascadeWords,
	check: NodeCheck,
): void {
	const tiers = node.cascade;
	if (tiers === undefined) return;
	const { title } = words;
	const labels = new Set<string>();
	tiers.forEach((tier, index) => {
		const label = tierLabel(tier, index);
		if (labels.has(label)) {
			check.error(
				`${title} node "${node.id}" has the tier "${label}" more than once. Give each tier its own name.`,
			);
		}
		labels.add(label);
		if (!isPersonTier(tier)) return;
		if (index !== tiers.length - 1) {
			check.error(
				`${title} node "${node.id}" has a person tier before other tiers. Only the last tier can be a person.`,
			);
		}
		checkTierDeadline(node.id, tier, words.personChoices, check);
	});
}

/** A person tier's deadline has one time and chooses one of the person's choices. */
function checkTierDeadline(
	nodeId: string,
	tier: PersonTier,
	choices: readonly string[],
	check: NodeCheck,
): void {
	const deadline = tier.deadline;
	if (deadline === undefined) return;
	const at = deadline.at?.trim() ?? "";
	if ((at === "") === (deadline.minutes === undefined)) {
		check.error(
			`The deadline of the person tier of "${nodeId}" needs a time or a number of minutes. Give it one of the two.`,
		);
	}
	if (at !== "") check.template(at, "deadline of the person tier");
	if (!choices.includes(deadline.choose)) {
		check.error(
			`The deadline of the person tier of "${nodeId}" chooses "${deadline.choose}", which the person cannot choose. Choose one of: ${choices.join(", ")}.`,
		);
	}
}

/** A model tier of a Decision or a Value, as its checks read it. */
export type ModelTierFields = {
	label?: string;
	profile?: NodeProfile;
	decider?: DeciderName;
	model?: string;
	address?: ModelAddress;
};

/**
 * The checks of a model tier: a profile left from format 6 must be picked
 * again, an address belongs to a Model Profile (ADR 5), and a decider
 * that needs an address needs a profile.
 */
export function checkModelTier(
	nodeId: string,
	tier: ModelTierFields,
	label: string,
	title: "Decision" | "Value",
	check: NodeCheck,
): void {
	if (tier.address !== undefined) {
		check.error(
			`The tier "${label}" of ${title} node "${nodeId}" sets an address. Put the address on a Model Profile, and pick that profile.`,
		);
	}
	if (tier.profile !== undefined && !isProfileRef(tier.profile)) {
		check.error(
			`The tier "${label}" of ${title} node "${nodeId}" names the profile "${tier.profile}", but Night Shift cannot tell which computer's profile it is. Pick the profile again.`,
		);
	}
	if (
		tier.profile === undefined &&
		tier.decider !== undefined &&
		deciderAddress(tier.decider) === "required"
	) {
		check.error(
			`The tier "${label}" of ${title} node "${nodeId}" uses the decider "${tier.decider}", which needs an address. Pick a Model Profile on ${tier.decider} that has one.`,
		);
	}
}

/**
 * A Decision's tier tests the probability of its pick. A decider that
 * gives none (ADR 6.8) can only be the last model tier, and its pick
 * always holds, so it takes no `minConfidence`. `decider` is the tier's
 * known decider: its own, else none when its profile gives it (the run
 * checks that one when it starts).
 */
export function probabilityProblem(input: {
	nodeId: string;
	label: string;
	decider: DeciderName | undefined;
	minConfidence: number | undefined;
	lastModelTier: boolean;
}): string | null {
	const { decider } = input;
	if (decider === undefined || deciderMeasuresProbability(decider)) return null;
	if (!input.lastModelTier) {
		return `The tier "${input.label}" of Decision node "${input.nodeId}" uses ${decider}, which gives no probability. Only the last model tier can use it. Move the tier to the end, or choose another decider.`;
	}
	if (input.minConfidence !== undefined) {
		return `The tier "${input.label}" of Decision node "${input.nodeId}" uses ${decider}, which gives no probability, so it cannot test a minimum confidence. Remove the minimum confidence.`;
	}
	return null;
}
