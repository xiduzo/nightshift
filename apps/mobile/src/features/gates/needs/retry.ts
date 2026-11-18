import type { RunStatus, RunSummary } from "@nightshift/client";

/** One tap on Retry or Resume, as the mutation cache keeps it. */
export type RetrySend = {
	runId: string;
	status: "idle" | "pending" | "success" | "error";
	/** When the tap went, epoch ms. */
	submittedAt: number;
};

/**
 * What the row of a run that stopped shows after a tap on Retry or
 * Resume: on its way ("sending"), taken by Night Shift ("sent"), or its
 * buttons again (null). The buttons come back when the tap failed, or
 * when the run stopped again after it.
 */
export function retryState(
	run: Pick<RunSummary, "id" | "endedAt">,
	sends: readonly RetrySend[],
): "sending" | "sent" | null {
	let last: RetrySend | undefined;
	for (const send of sends) {
		if (send.runId !== run.id) continue;
		if (!last || send.submittedAt > last.submittedAt) last = send;
	}
	if (!last) return null;
	if (run.endedAt !== null && run.endedAt > last.submittedAt) return null;
	if (last.status === "pending") return "sending";
	if (last.status === "success") return "sent";
	return null;
}

/** The button of a run that stopped: Retry a run that failed, Resume one that stopped. */
export function retryLabel(status: RunStatus): "Retry" | "Resume" {
	return status === "failed" ? "Retry" : "Resume";
}
