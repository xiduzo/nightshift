import type { LoggedEvent } from "../events";
import type { Draft } from "./draft";
import { settle } from "./fold-step";
import type { DerivedSession } from "./run-state";

/** What an event of a session means for the run state (`fold-run.ts`). */

export function applySessionEvent(
	run: Draft,
	e: LoggedEvent,
	sessionId: string,
): void {
	let session: DerivedSession | undefined;
	if (e.type === "SessionStarted") {
		session = {
			id: sessionId,
			stepId: e.stepId,
			prompt: e.payload.prompt,
			resumeSessionId: e.payload.resumeSessionId,
			harness: e.payload.harness ?? "claude-code",
			harnessSessionId: null,
			model: null,
			startedAt: e.at,
			startSeq: e.seq,
			opening: openingOf(run, e.stepId),
			endedAt: null,
			lastAt: e.at,
			ending: null,
			spent: null,
		};
	} else {
		const known = run.sessions.get(sessionId);
		if (!known) return;
		session = { ...known };
		if (session.endedAt === null) session.lastAt = e.at;
		if (e.type === "HarnessSessionAssigned") {
			session.harnessSessionId ??= e.payload.harnessSessionId;
			session.model ??= e.payload.model;
		} else if (e.type === "SessionUsage") {
			session.spent = e.payload;
		} else if (e.type === "SessionEnded" && session.ending === null) {
			session.ending = e.payload;
			session.endedAt = e.at;
		}
	}
	run.sessions.set(sessionId, session);
	const step = session.stepId ? run.steps.get(session.stepId) : undefined;
	if (!step) return;
	const at = step.sessions.findIndex((s) => s.id === sessionId);
	const sessions =
		at === -1
			? [...step.sessions, session]
			: step.sessions.map((s, i) =>
					i === at ? (session as DerivedSession) : s,
				);
	run.steps.set(step.id, settle({ ...step, sessions }));
}

/** The index of the step's latest opening, or null when the log has no such step. */
function openingOf(run: Draft, stepId: string | null): number | null {
	const step = stepId ? run.steps.get(stepId) : undefined;
	return step ? step.openings.length - 1 : null;
}
