import { asDate } from "@nightshift/time";
import type { RunRecord } from "../../application/open-run";
import type { RunRecords } from "../../application/ports";

/** The Walker the in-memory runs name when a test gives none: this computer. */
export const THIS_COMPUTER = "this-computer";

/** A run's row for a test: the columns a test names, the others blank. */
export function runRecord(
	run: Pick<RunRecord, "id" | "spaceId"> & Partial<RunRecord>,
): RunRecord {
	return {
		projectId: "project-1",
		flowName: null,
		flow: "{}",
		bodyFlows: "{}",
		flowRevision: null,
		bodyFlowRevisions: "{}",
		title: "test",
		worktreePath: "",
		branch: "",
		baseRef: "",
		walkerId: THIS_COMPUTER,
		deviceId: null,
		placements: null,
		deviceNames: null,
		fallbacks: null,
		startedBy: null,
		createdAt: asDate(0),
		...run,
	};
}

/**
 * The runs of a Replica in memory. A test adds a run (`add`) and moves its
 * walk to another Device (`moveAway`), as a `WalkerMoved` does.
 */
export function inMemoryRunRecords(walkerId = THIS_COMPUTER) {
	const runs = new Map<string, RunRecord>();
	const twin = {
		add(run: RunRecord) {
			runs.set(run.id, run);
		},
		moveAway(runId: string, to: string) {
			const run = runs.get(runId);
			if (run) runs.set(runId, { ...run, walkerId: to });
		},
		async find(runId: string) {
			return runs.get(runId) ?? null;
		},
		async walkedHere(run: Pick<RunRecord, "walkerId">) {
			return run.walkerId === walkerId;
		},
	};
	return twin satisfies RunRecords;
}

export type InMemoryRunRecords = ReturnType<typeof inMemoryRunRecords>;
