/**
 * What to learn from a run that ended: the Learner's one answer (ADR 37).
 * The engine finds a run worth a look and hands over its evidence as text:
 * the run, what went wrong, what fixed it, what a person answered and the
 * learnings the project has. The Learner reads no files and calls no tool.
 * It answers with a step report whose data holds at most five learnings,
 * from an agent session or from one model call (`runReportSession`).
 */
import type { AssistantUsage } from "@nightshift/flows";
import { type AssistantVia, runReportSession } from "./session";

/** The most learnings of one answer. */
export const MAX_RUN_LEARNINGS = 5;

/** The most characters of one learning: a sentence or two. */
const LEARNING_LIMIT = 300;

/** The shape of the report's data. */
const OUTPUT = {
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

/** The prompt of one look back: the rules of a learning, then the evidence. */
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

/** The Learner's answer: the learnings, and what the answer cost. */
export type RunLearnings =
	| { kind: "learned"; notes: string[]; usage: AssistantUsage | null }
	| { kind: "error"; message: string; usage: AssistantUsage | null };

/** The learnings of a report's data: strings, trimmed, at most five, each cut. */
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

/**
 * Asks the Learner what to learn from one run. Never throws: a failure is
 * an `error` with what it cost so far. A report with no learnings is an
 * answer: nothing to learn.
 */
export async function learnFromRun(input: {
	evidence: string;
	/** What answers for the Learner: an agent of this computer, or a model. */
	via: AssistantVia;
	signal: AbortSignal;
}): Promise<RunLearnings> {
	let usage: AssistantUsage | null = null;
	for await (const event of runReportSession(input.via, {
		prompt: learnFromRunPrompt(input.evidence),
		report: { output: OUTPUT },
		signal: input.signal,
	})) {
		switch (event.type) {
			case "usage":
				usage = event.usage;
				break;
			case "error":
				return { kind: "error", message: event.message, usage };
			case "end":
				return {
					kind: "learned",
					notes: reportedLearnings(event.report?.data),
					usage,
				};
			default:
				break;
		}
	}
	return { kind: "error", message: "The Learner gave no answer.", usage };
}
