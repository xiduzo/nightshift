import { type EntryFold, useLiveRun } from "@nightshift/client";

import { client, orpc } from "@/shared/api";
import {
	applyEntries,
	emptyRunTranscript,
	type RunTranscript,
} from "../transcript/transcript";

/** The run page keeps the transcript grouped by step. */
const BY_STEP: EntryFold<RunTranscript> = {
	empty: () => emptyRunTranscript,
	add: applyEntries,
};

/**
 * Follows one run live through the live cache (`useLiveRun`: reconnects
 * with backoff, hands on each entry once, in batches of 50 ms). A run
 * another device walks streams the same way: the server follows its
 * running step live through the Host. The page lays the steps over the
 * run it read; the live cache reads the run again when a step starts or
 * ends, for the edge traversals.
 */
export function useRunStream(runId: string) {
	const { entries, ...live } = useLiveRun({ client, orpc }, runId, {
		entries: BY_STEP,
	});
	return { ...live, transcript: entries };
}
