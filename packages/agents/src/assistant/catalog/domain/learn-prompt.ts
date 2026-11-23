import type { AssistantUsage } from "@nightshift/flows";

export const MAX_RUN_LEARNINGS = 5;

const LEARNING_LIMIT = 300;

export const LEARN_OUTPUT = {
	type: "object",
	properties: {
		learnings: {
			type: "array",
			items: { type: "string" },
			maxItems: MAX_RUN_LEARNINGS,
		},
	},
	required: ["learnings"],
	additionalProperties: false,
};

export function learnFromRunPrompt(evidence: string): string {
	return [
		"A Night Shift run of this project ended. Look back at it, and propose what the next agents of this project should know.",
		"",
		"# A learning",
		"",
		"- One fact about this project, its tools, its data or its environment that would have saved time or a mistake in this run.",
		'- It holds for later runs too. It is not a summary of this run and not a status, such as "the build failed".',
		'- It tells the next agent what to do or what to expect. Example: "The import needs the VPN. Check the connection before the first step."',
		"- One or two short sentences, plain text, no Markdown.",
		"- Never a secret, a password, a token or private data of a person.",
		"",
		"# How to work",
		"",
		"1. Read the run below: what went wrong, what fixed it, and what a person answered and why.",
		"2. An answer of a person with a reason is the strongest evidence. Turn it into a rule the agents can follow.",
		"3. Leave out what the learnings of the project already say.",
		"4. Do not guess. When the run shows no lesson, give no learnings. An empty list is a good answer.",
		"",
		"# The answer",
		"",
		`Report the learnings in \`data.learnings\`: a list of at most ${MAX_RUN_LEARNINGS}. Write one sentence in the summary: what you looked at.`,
		"",
		evidence,
	].join("\n");
}

export type RunLearnings =
	| { kind: "learned"; notes: string[]; usage: AssistantUsage | null }
	| { kind: "error"; message: string; usage: AssistantUsage | null };

export function reportedLearnings(data: unknown): string[] {
	const list =
		typeof data === "object" && data !== null
			? (data as { learnings?: unknown }).learnings
			: undefined;
	if (!Array.isArray(list)) return [];
	return list
		.filter((note): note is string => typeof note === "string")
		.map((note) => note.replace(/\s+/g, " ").trim())
		.filter((note) => note !== "")
		.slice(0, MAX_RUN_LEARNINGS)
		.map((note) =>
			note.length > LEARNING_LIMIT
				? `${note.slice(0, LEARNING_LIMIT - 1).trimEnd()}…`
				: note,
		);
}
