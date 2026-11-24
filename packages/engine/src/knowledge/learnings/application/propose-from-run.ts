import type { KnowledgeReconciler } from "../../sync";
import type { ProposeLearnings } from "./propose-learnings";

export type ProposeFromRunPorts = {
	holds: Pick<KnowledgeReconciler, "startStep">;
	/** `proposeLearnings`, bound by the wire. */
	propose(request: ProposeLearnings): Promise<void>;
};

/** The run that ended, and what Night Shift learned from it. */
export type ProposeFromRun = {
	projectId: string;
	runId: string;
	notes: readonly string[];
};

/**
 * Proposes what Night Shift learned when it looked back at a run that
 * ended (ADR 37), in the run's own file, `<runId>.md`. It holds the folder
 * as a step does: the reconcile at its end puts the file in the Space. No
 * note: nothing is written, and the folder is not held.
 */
export const proposeFromRun =
	(ports: ProposeFromRunPorts) =>
	async ({ projectId, runId, notes }: ProposeFromRun): Promise<void> => {
		if (notes.length === 0) return;
		const hold = await ports.holds.startStep(projectId);
		try {
			await ports.propose({ projectId, step: { runId }, notes, by: "run" });
		} finally {
			await hold.done();
		}
	};
