import { type AuthoringRun, runReport } from "./authoring";

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