import {
	type AgentMessages,
	applyAgentMessages,
	applyStepChanges,
	type EntryFold,
	type LiveRun,
	type StepChanges,
	useLiveRun,
} from "@nightshift/client";

import { useSignedIn } from "@/features/host";
import { useInFront } from "@/shared/in-front";
import { useWhileFocused } from "@/shared/refresh";

/** What the run screen keeps of the transcript, per step. */
type RunEntries = {
	/** The latest agent message of each step. */
	messages: AgentMessages;
	/** The files each step changed, with line counts. */
	changes: StepChanges;
};

/**
 * The run screen keeps the latest agent message and the changed files of
 * each step. A part with nothing new stays the same object.
 */
const ENTRIES: EntryFold<RunEntries> = {
	empty: () => ({ messages: new Map(), changes: new Map() }),
	add: (kept, entries) => {
		const messages = applyAgentMessages(kept.messages, entries);
		const changes = applyStepChanges(kept.changes, entries);
		return messages === kept.messages && changes === kept.changes
			? kept
			: { messages, changes };
	},
};

/** One run on the run screen: its steps, its status, and per step its latest agent message and changed files. */
export type PhoneLiveRun = LiveRun<RunEntries>;

/**
 * Follows one run live through the live cache, in batches of 100 ms.
 * While the app is in the background it stops and keeps what came; when
 * the app comes back it follows on after the last entry it has. While
 * another screen covers it, it keeps what comes but does not render for
 * it, and shows it all on focus. The run screen and its Changed files
 * screen share what came.
 */
export function usePhoneLiveRun(runId: string): PhoneLiveRun {
	const { host } = useSignedIn();
	const inFront = useInFront();
	return useLiveRun(host, runId, {
		entries: ENTRIES,
		paused: !inFront,
		flushMs: 100,
		...useWhileFocused(),
	});
}
