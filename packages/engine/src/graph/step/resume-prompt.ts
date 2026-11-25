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
 * Got: a session of the step started after it. That session may have no
 * name (`HarnessSessionAssigned`): a crash or a stop came first, and the log
 * cannot tell whether the harness got the prompt. A harness names its
 * session before its first turn, so no turn acted on it. Then one kind goes
 * again (at-least-once): a resume of a step at rest, whose session had ended
 * on its own (it asked, failed or hit a limit). All else goes once
 * (at-most-once): an answer, a wake, and a resume of a step that a stop or a
 * crash cut short at work.
 */
export function resumePrompt(
	run: RunState,
	step: DerivedStep,
	answer?: string,
): string {
	const started = step.sessions.at(-1)?.startSeq ?? -1;
	const named =
		step.sessions.findLast((s) => s.harnessSessionId !== null)?.startSeq ?? -1;
	const reopened = step.openings.findLast(
		(o) => o.prompt !== null && o.seq > started,
	);
	const told: { seq: number; prompt: string }[] = [];
	for (const { seq, payload } of run.resumes) {
		const { stepId, prompt, action } = payload;
		// A run again tells a new visit (`rerunEntryOf`), not this step.
		if (stepId !== step.id || action === "rerun" || prompt === null) continue;
		if (seq > (atRest(step, seq) ? named : started)) told.push({ seq, prompt });
	}
	for (const { seq, stepId, payload } of run.earlyWakes) {
		if (stepId !== step.id || payload.prompt === undefined) continue;
		if (seq > started) told.push({ seq, prompt: payload.prompt });
	}
	const prompts = new Set([
		...(reopened?.prompt ? [reopened.prompt] : []),
		...(answer ? [answer] : []),
		...told
			.filter(({ seq }) => seq > (reopened?.seq ?? -1))
			.sort((a, b) => a.seq - b.seq)
			.map(({ prompt }) => prompt),
	]);
	prompts.delete(DEFAULT_RESUME_PROMPT);
	return [...prompts].join("\n\n") || DEFAULT_RESUME_PROMPT;
}

/** Whether the step's session had ended on its own at `seq`: nothing cut it short at work. */
function atRest(step: DerivedStep, seq: number): boolean {
	const session = step.sessions.findLast((s) => s.startSeq < seq);
	const outcome = session?.ending?.outcome;
	return outcome === "finished" || outcome === "failed";
}
