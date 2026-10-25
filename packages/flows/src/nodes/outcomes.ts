import { z } from "zod";
import { labelSchema, type NodeCheck, reservedOutcomes } from "./base";

/**
 * The outcomes a node lists itself: an Agent's own outcomes, a Command's
 * exits and a Decision's options. Each has a name, an optional description
 * and an optional colour.
 */

/**
 * The colours an outcome can take: Tailwind colour names. The web app picks
 * the shade for light and dark. Unset: a colour from the outcome's name.
 */
export const outcomeColors = [
	"red",
	"orange",
	"amber",
	"yellow",
	"lime",
	"green",
	"teal",
	"cyan",
	"sky",
	"blue",
	"indigo",
	"violet",
	"pink",
	"gray",
] as const;
export const outcomeColorSchema = z.enum(outcomeColors);
export type OutcomeColor = z.infer<typeof outcomeColorSchema>;

export const option = z.object({
	name: labelSchema,
	/** Tells the agent, the model or the person what this option means. */
	description: z.string().optional(),
	color: outcomeColorSchema.optional(),
	/**
	 * Decision nodes decided by a rule only: a JSONata expression over the
	 * run's values (`build.data.tests_passed = true and check.exit_code = 0`).
	 * The first option whose rule holds is the outcome. An option without a
	 * rule is the default: at most one, and it goes last.
	 */
	when: z.string().optional(),
});
export type Option = z.infer<typeof option>;

/**
 * Why `name` is not an option of the node, or null when it is one. The one
 * check for an answer from a person, a model or a rule: the engine, the
 * Gate API and the model's `decide` tool all use it.
 */
export function optionProblem(
	options: readonly Pick<Option, "name">[],
	name: string,
): string | null {
	const names = options.map((option) => option.name);
	if (names.includes(name)) return null;
	return `"${name}" is not an option of this node. Choose one of: ${names.join(", ")}.`;
}

/** How the issues of `checkOptions` name the node, its outcomes and who picks one. */
export type OptionWords = {
	/** "Agent". */
	title: string;
	/** "outcome". */
	kind: string;
	/** "the agent reports". */
	picker: string;
};

/**
 * Agent outcomes and Decision options are outcomes: each must be a valid
 * label, unique within its node and not reserved for the engine. One
 * without an edge is allowed, but ending on it ends the run there: a warning,
 * except an outcome that fails the step anyway (`failing`).
 */
export function checkOptions(
	nodeId: string,
	outcomes: readonly string[],
	words: OptionWords,
	failing: (name: string) => boolean,
	check: NodeCheck,
): void {
	const { title, kind, picker } = words;
	const reserved: readonly string[] = reservedOutcomes;
	const seen = new Set<string>();
	for (const name of outcomes) {
		if (seen.has(name)) {
			check.error(
				`${title} node "${nodeId}" has the ${kind} "${name}" more than once.`,
			);
			continue;
		}
		seen.add(name);
		const valid = labelSchema.safeParse(name);
		if (!valid.success) {
			check.error(
				`${title} node "${nodeId}" has the ${kind} "${name}", which is not a valid label: ${valid.error.issues[0]?.message ?? "not allowed"}`,
			);
			continue;
		}
		if (reserved.includes(name)) {
			check.error(
				`${title} node "${nodeId}" uses the ${kind} "${name}", which is reserved. Do not use: ${reserved.join(", ")}.`,
			);
			continue;
		}
		if (!check.routed(name) && !failing(name)) {
			check.warning(
				`${title} node "${nodeId}" has no edge for "${name}": the run ends there when ${picker} "${name}".`,
			);
		}
	}
}
