import {
	type RunStreamConnection,
	type TranscriptEntry,
	useLiveCache,
} from "@nightshift/client";
import { useEffect, useState } from "react";

import { useSignedIn } from "@/features/host";

/** The most entries the sheet keeps: the newest ones. */
const MAX_ENTRIES = 5000;

/**
 * The transcript entries of one run while the transcript sheet is open:
 * what the run saved first, then live. It stops when the sheet closes.
 */
export function useRunTranscript(runId: string): {
	entries: TranscriptEntry[];
	connection: RunStreamConnection;
} {
	const { host } = useSignedIn();
	const live = useLiveCache(host.orpc);
	const [entries, setEntries] = useState<TranscriptEntry[]>([]);
	const [connection, setConnection] =
		useState<RunStreamConnection>("connecting");

	useEffect(() => {
		const controller = new AbortController();
		setEntries([]);
		void live.followRun({
			client: host.client,
			runId,
			signal: controller.signal,
			flushMs: 150,
			onConnection: setConnection,
			onBatch: (batch) => {
				if (batch.entries.length === 0) return;
				setEntries((current) =>
					[...current, ...batch.entries].slice(-MAX_ENTRIES),
				);
			},
		});
		return () => controller.abort();
	}, [runId, host.client, live]);

	return { entries, connection };
}
