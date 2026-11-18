import type { TranscriptEntry } from "@/shared/api";
import { applyStepEntries } from "./step-entries";
import { emptyTranscript, type RunTranscript } from "./transcript-state";

/**
 * Folds the raw transcript entries of a run into display items, per step. An
 * agent step gets one block per assistant message, one item per thought, one
 * row per tool call (a subagent's work inside the call that started it), a
 * boundary per session, its step report, and the events that end a session.
 * A command step gets its command line, one log, and its exit code. A
 * decision step gets what was asked and the label it picked; a gate step its
 * question and the answer. A Call step with `each` gets the item lists it read and a
 * start and an end per item. A wait of the run policy shows where it happens,
 * with the wake that ends it. What a step changed in the run's copy of the
 * project is no item: the step keeps the last list (`changes`). Folding is
 * incremental so a long replay and a fast live stream only touch the items
 * that change.
 */

/** Applies entries in seq order. Entries at or below `lastSeq` are ignored. */
export function applyEntries(
	state: RunTranscript,
	entries: TranscriptEntry[],
): RunTranscript {
	const fresh = entries.filter((entry) => entry.seq > state.lastSeq);
	if (fresh.length === 0) return state;
	fresh.sort((a, b) => a.seq - b.seq);

	const byStep = new Map<string, TranscriptEntry[]>();
	for (const entry of fresh) {
		const list = byStep.get(entry.stepId);
		if (list) list.push(entry);
		else byStep.set(entry.stepId, [entry]);
	}

	let lastWait = state.lastWait;
	for (const entry of fresh) {
		const event = entry.event;
		if (event.type === "wait") {
			lastWait = {
				stepId: entry.stepId,
				reason: event.reason,
				until: event.until,
				message: event.message,
				...(event.signal !== undefined ? { signal: event.signal } : {}),
				at: entry.at,
			};
		} else if (event.type === "wake") {
			lastWait = null;
		}
	}

	const steps = new Map(state.steps);
	for (const [stepId, stepEntries] of byStep) {
		steps.set(
			stepId,
			applyStepEntries(steps.get(stepId) ?? emptyTranscript, stepEntries),
		);
	}

	return {
		steps,
		lastSeq: fresh[fresh.length - 1]?.seq ?? state.lastSeq,
		lastWait,
	};
}
