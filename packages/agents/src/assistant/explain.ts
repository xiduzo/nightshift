/**
 * Why a run did not finish, in one short answer: a read-only session that
 * reads the run (its steps, the failed step and the end of its
 * transcript, all in the prompt) and the project in its folder, and
 * answers with a step report whose summary is the answer. No thread, no
 * tools, no proposal: the phone asks once and shows the answer.
 */
import type { AgentProfileSettings, ExplanationEvent } from "@nightshift/flows";
import type { AgentHarness } from "../port";
import { runAssistantSession } from "./session";
import { type AuthoringRun, runReport } from "./tools";

/** The most characters of an answer: a few sentences. */
const ANSWER_LIMIT = 1_200;

/** The prompt of one explanation: the rules of the answer, then the run. */
export function explanationPrompt(run: AuthoringRun): string {
	return [
		"A Night Shift run did not finish. A person asks why, on their phone. Explain it in one short answer.",
		"",
		"# How to work",
		"",
		"1. Read the run below: the step that failed, its error and the end of its transcript.",
		"2. Read the project in this folder only when the cause needs it. Change nothing.",
		"3. Do not guess. When the run does not show the cause, say so, and say what the person can check.",
		"",
		"# The answer",
		"",
		"Report it as the summary of your step report. Write two to four short sentences, plain text, no Markdown, no lists:",
		"",
		"1. What went wrong, in the words of the work: the step by its label or its role, not its id.",
		"2. What the person can do now. Pick from: try the run again, continue it, answer a question it asked, sign in to a tool again, or fix the flow on the desktop.",
		"",
		'Address the person as "you". Use active voice and simple present. At most 20 words a sentence. No semicolons, no contractions.',
		'Do not name what is inside Night Shift: no file paths, folders, worktrees, exit codes, stdout or stderr, environment variables, process names, ports, stack traces, or the daemon. Say "Night Shift" or "this computer" instead.',
		"",
		runReport(run, run.flow, "The flow"),
	].join("\n");
}

export type ExplainRunInput = {
	run: AuthoringRun;
	/** The harness that answers, as this computer runs it. */
	harness: AgentHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	/** The project's Clone on this computer, or a folder of its own. */
	cwd: string;
	signal: AbortSignal;
};

/**
 * Stream one explanation: what the agent does, what it used, then the
 * answer and `done`, or an `error`. Never throws.
 */
export async function* explainRun(
	input: ExplainRunInput,
): AsyncGenerator<ExplanationEvent> {
	for await (const event of runAssistantSession({
		harness: input.harness,
		profile: input.profile,
		cwd: input.cwd,
		prompt: explanationPrompt(input.run),
		report: {},
		signal: input.signal,
	})) {
		switch (event.type) {
			case "activity":
			case "usage":
				yield event;
				break;
			case "error":
				yield { type: "error", message: event.message };
				return;
			case "end": {
				// A harness that ends without a report answered in its text.
				const answer = plain(event.report?.summary || event.text);
				if (answer === "") {
					yield {
						type: "error",
						message: "The agent stopped without an answer. Ask again.",
					};
					return;
				}
				yield { type: "answer", answer };
				yield { type: "done" };
				return;
			}
			default:
				break;
		}
	}
}

/** The answer as plain text on few lines, at most `ANSWER_LIMIT` characters. */
function plain(text: string): string {
	const flat = text
		.replace(/\*\*|__|`/g, "")
		.replace(/^#+\s*/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return flat.length > ANSWER_LIMIT
		? `${flat.slice(0, ANSWER_LIMIT - 1).trimEnd()}…`
		: flat;
}
