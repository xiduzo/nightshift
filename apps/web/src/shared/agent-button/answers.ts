import type { BuiltinAgentId, BuiltinStatus } from "@nightshift/flows";

/** The Settings page of one of Night Shift's own agents, as the search of `/settings`. */
export function builtinSettingsSearch(agent: BuiltinAgentId): {
	section: string;
	agent: string;
} {
	return { section: "builtin", agent };
}

type Answers = NonNullable<BuiltinStatus["answers"]>;

/**
 * The name of what answers for a built-in agent: the profile, else the
 * harness and its model ("Claude Code · sonnet"), else the model.
 * `harnessLabel` gives the name of a harness in the product.
 */
export function answersLabel(
	answers: Answers,
	harnessLabel: (
		harness: Extract<Answers, { kind: "agent" }>["harness"],
	) => string,
): string {
	if (answers.profile) return answers.profile;
	const parts =
		answers.kind === "agent"
			? [harnessLabel(answers.harness), answers.model]
			: [answers.decider, answers.model];
	return parts.filter(Boolean).join(" · ");
}
