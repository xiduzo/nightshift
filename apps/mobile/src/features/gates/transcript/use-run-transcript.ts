import {
	type EntryFold,
	type RunStreamConnection,
	type TranscriptEntry,
	useLiveRun,
} from "@nightshift/client";

import { useSignedIn } from "@/features/host";
import { useWhileFocused } from "@/shared/refresh";

/** The most entries the sheet keeps: the newest ones. */
const MAX_ENTRIES = 5000;

/** The sheet keeps the newest entries. */
const NEWEST: EntryFold<TranscriptEntry[]> = {
	empty: () => [],
	add: (kept, entries) => [...kept, ...entries].slice(-MAX_ENTRIES),
};

/**
 * The transcript entries of one run while the transcript sheet is open:
 * what the run saved first, then live. It stops when the sheet closes.
 * Under another screen it keeps what comes without rendering for it.
 */
export function useRunTranscript(runId: string): {
	entries: TranscriptEntry[];
	connection: RunStreamConnection;
} {
	const { host } = useSignedIn();
	const { entries, connection } = useLiveRun(host, runId, {
		entries: NEWEST,
		flushMs: 150,
		...useWhileFocused(),
	});
	return { entries, connection };
}
