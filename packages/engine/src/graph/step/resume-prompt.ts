import type { DerivedStep, RunState } from "../../log";
import { DEFAULT_RESUME_PROMPT } from "../context";

/**
 * What the harness session of a step was told and did not get yet, from the
 * log. This is the one owner of that question: no caller keeps a prompt, and
 * the checkpoint holds none.
 *
 * Told: a `RunResumed` that names the step, the `WaitEnded` of a person who
 * woke it, and the answer at its Gate (`answer`, until the reopen that
 * closes the Gate). A `StepReopened` carries all of it so far. What was
 * told twice before the session got it goes as one prompt, in order.
 *
 * Got: a session of the step that the harness named
 * (`HarnessSessionAssigned`). A harness names its session before its first
 * turn. The log cannot tell whether a session with no name got its prompt.
 * When the daemon died there or the harness failed, the prompt goes again
 * (at-least-once): nobody is there to say it again, and no turn acted on
 * it. When a person stopped the run there, it does not go again
 * (at-most-once): the run page shows it as sent, and the person who
 * continues can say it again.
 */
export function resumePrompt(
	run: RunState,
	step: DerivedStep,
	answer?: string,
): string {
	const got = step.sessions.findLast(
		(s) => s.harnessSessionId !== null || s.ending?.outcome === "stopped",
	);
	const reopened = step.openings.findLast(
		(o) => o.prompt !== null && o.seq > (got?.startSeq ?? -1),
	);
	const since = reopened?.seq ?? got?.startSeq ?? -1;
	const told: { seq: number; prompt: string }[] = [];
	for (const { seq, payload } of run.resumes) {
		// A run again tells a new visit (`rerunEntryOf`), not this step.
		if (payload.stepId !== step.id || payload.action === "rerun") continue;
		if (payload.prompt !== null) told.push({ seq, prompt: payload.prompt });
	}
	for (const { seq, stepId, payload } of run.earlyWakes) {
		if (stepId !== step.id || payload.prompt === undefined) continue;
		told.push({ seq, prompt: payload.prompt });
	}
	const prompts = new Set([
		...(reopened?.prompt ? [reopened.prompt] : []),
		...(answer ? [answer] : []),
		...told
			.filter(({ seq }) => seq > since)
			.sort((a, b) => a.seq - b.seq)
			.map(({ prompt }) => prompt),
	]);
	prompts.delete(DEFAULT_RESUME_PROMPT);
	return [...prompts].join("\n\n") || DEFAULT_RESUME_PROMPT;
}
