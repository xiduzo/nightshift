import {
	type AgentMessages,
	applyAgentMessages,
	type EntryFold,
	type LiveRun,
	useLiveRun,
} from "@nightshift/client";

import { useSignedIn } from "@/features/host";
import { useInFront } from "@/shared/in-front";

/** The run screen keeps the latest agent message of each step. */
const MESSAGES: EntryFold<AgentMessages> = {
	empty: () => new Map(),
	add: applyAgentMessages,
};

/** One run on the run screen: its steps, its status and the latest agent message of each step. */
export type PhoneLiveRun = LiveRun<AgentMessages>;

/**
 * Follows one run live through the live cache, in batches of 100 ms.
 * While the app is in the background it stops and keeps what came; when
 * the app comes back it follows on after the last entry it has.
 */
export function usePhoneLiveRun(runId: string): PhoneLiveRun {
	const { host } = useSignedIn();
	const inFront = useInFront();
	return useLiveRun(host, runId, {
		entries: MESSAGES,
		paused: !inFront,
		flushMs: 100,
	});
}
