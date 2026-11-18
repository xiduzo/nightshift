import { type RunSummary, useRunActed } from "@nightshift/client";
import {
	type Mutation,
	useMutation,
	useMutationState,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useSignedIn } from "@/features/host";
import type { RetrySend } from "./retry";

/** One tap of the mutation cache, as the rows read it. */
function sendOf(mutation: Mutation<unknown, Error, unknown>): RetrySend | null {
	const { status, variables, submittedAt } = mutation.state;
	const runId = (variables as { runId?: string } | undefined)?.runId;
	return runId ? { runId, status, submittedAt } : null;
}

/**
 * Retry and Resume of the runs that stopped: both resume the run. `sends`
 * holds each tap, also of a screen that is closed now (`retryState` reads
 * them per run). Once Night Shift takes it, the live cache reads the run
 * again, and the run leaves the list. `failure` says why the last tap did
 * not work.
 */
export function useRetryRuns() {
	const { host } = useSignedIn();
	const runActed = useRunActed(host);
	const options = useMemo(
		() =>
			host.orpc.runs.resume.mutationOptions({
				onSuccess: (_data, { runId }) => runActed(runId),
			}),
		[host, runActed],
	);
	const resume = useMutation(options);
	const all = useMutationState({
		filters: { mutationKey: options.mutationKey },
		select: sendOf,
	});
	const sendsId = all
		.map((send) =>
			send ? `${send.runId}:${send.status}:${send.submittedAt}` : "",
		)
		.join("\n");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the joined sends say when the list changes.
	const sends = useMemo(
		() => all.filter((send): send is RetrySend => send !== null),
		[sendsId],
	);

	const mutate = resume.mutate;
	const onRetry = useCallback(
		(run: RunSummary) => mutate({ runId: run.id }),
		[mutate],
	);
	const failure = resume.error
		? { title: "The run did not continue", message: resume.error.message }
		: null;
	return { sends, onRetry, failure };
}
