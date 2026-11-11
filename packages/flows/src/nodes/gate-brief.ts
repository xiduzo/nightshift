import { z } from "zod";
import type { NodeCheck } from "./base";

/**
 * The brief of a Gate (ADR 21): how urgent it is, why a person must
 * decide, what is already done, and which option the flow recommends. A
 * Decision decided by a person, the person tier of a cascade and an Ask
 * (a Value made by a person) may set these fields. Each one is optional
 * and takes templates. What the author leaves empty, a model may write as
 * the Gate opens (`fillBrief`, on by default).
 */

/** How soon a Gate needs an answer: the inbox groups it under Now, Today or When you have time. */
export const GATE_URGENCIES = ["now", "today", "later"] as const;
export const gateUrgencySchema = z.enum(GATE_URGENCIES);
export type GateUrgency = z.infer<typeof gateUrgencySchema>;

/** The urgency of a Gate that neither the flow nor a model sets. */
export const DEFAULT_GATE_URGENCY: GateUrgency = "today";

/** Whether `text` is one of the three urgencies. */
export function isGateUrgency(text: string): text is GateUrgency {
	return (GATE_URGENCIES as readonly string[]).includes(text);
}

/**
 * The option the flow recommends, and why. `option` names one of the
 * Decision's options, or a template that renders to one. One that renders
 * to no option is left out when the Gate opens.
 */
export interface GateRecommend {
	option: string;
	reason?: string;
}

export const gateRecommendSchema: z.ZodType<GateRecommend> = z.object({
	option: z.string().trim().min(1),
	reason: z.string().optional(),
});

/** The brief fields of a Gate's node, as a flow file holds them. */
export interface GateBriefFields {
	urgency?: string;
	situation?: string;
	background?: string;
	recommend?: GateRecommend;
	fillBrief?: boolean;
}

/**
 * The brief fields every node a person answers may set. `recommend` is a
 * Decision's only (`gateRecommendField`): it names an option.
 */
export const gateBriefFields = {
	/**
	 * A person answers only: how soon. `now`, `today` or `later`, or a
	 * template that renders to one (`{{triage.data.urgency}}`). A template
	 * that renders to anything else is left out. Unset: a model picks one,
	 * else `today`.
	 */
	urgency: z.string().trim().min(1).optional(),
	/** A person answers only: why a person must decide, in one or two sentences. Templates. */
	situation: z.string().optional(),
	/**
	 * A person answers only: what is already decided, checked or done. A
	 * line that starts with `- ` is one item. An item may end with
	 * ` (source: X)`. Templates.
	 */
	background: z.string().optional(),
	/**
	 * A person answers only: a model may write the parts of the brief the
	 * flow leaves empty when the Gate opens. Unset: true.
	 */
	fillBrief: z.boolean().optional(),
};

/** A Decision's recommendation: one of its options, and why. */
export const gateRecommendField = {
	/** A person answers only: the option the flow recommends, and why. Templates. */
	recommend: gateRecommendSchema.optional(),
};

/** The brief fields a node sets, by name. */
export function briefFieldsSet(fields: GateBriefFields): string[] {
	return (
		["urgency", "situation", "background", "recommend", "fillBrief"] as const
	).filter((name) => fields[name] !== undefined);
}

/** How the checks of a brief name its node. */
export type BriefWords = {
	/** `Decision node "pick"`, or `The person tier of "pick"`. */
	subject: string;
	/** A person answers it. */
	asks: boolean;
	/** The options a recommendation may name; null where none may. */
	options: readonly string[] | null;
	/** "let a person decide": how to make a person answer it. */
	fix: string;
};

const hasTemplate = (text: string) => text.includes("{{");

/**
 * The brief belongs to a Gate: only a node a person answers sets it. A
 * literal urgency is one of the three, a literal recommendation is one of
 * the options, and the templates read known names.
 */
export function checkGateBrief(
	fields: GateBriefFields,
	words: BriefWords,
	check: NodeCheck,
): void {
	const set = briefFieldsSet(fields);
	if (set.length === 0) return;
	if (!words.asks) {
		check.error(
			`${words.subject} sets ${set.join(", ")}, but a person does not answer it. Only a person reads the brief. Remove ${set.length === 1 ? "it" : "them"}, or ${words.fix}.`,
		);
		return;
	}
	const { urgency, situation, background, recommend } = fields;
	if (urgency !== undefined) {
		if (!hasTemplate(urgency) && !isGateUrgency(urgency.trim())) {
			check.error(
				`${words.subject} has the urgency "${urgency}". Use one of: ${GATE_URGENCIES.join(", ")}.`,
			);
		}
		check.template(urgency, "urgency");
	}
	if (situation !== undefined) check.template(situation, "situation");
	if (background !== undefined) check.template(background, "background");
	if (recommend === undefined) return;
	if (words.options === null) {
		check.error(
			`${words.subject} recommends "${recommend.option}", but it has no options to recommend. Remove the recommendation.`,
		);
		return;
	}
	if (
		!hasTemplate(recommend.option) &&
		!words.options.includes(recommend.option.trim())
	) {
		check.error(
			`${words.subject} recommends "${recommend.option}", which is not one of its options. Choose one of: ${words.options.join(", ")}.`,
		);
	}
	check.template(recommend.option, "recommendation");
	if (recommend.reason !== undefined) {
		check.template(recommend.reason, "recommendation reason");
	}
}
