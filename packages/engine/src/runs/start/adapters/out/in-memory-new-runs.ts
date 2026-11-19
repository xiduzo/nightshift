import { asDate } from "@nightshift/time";
import {
	foldRun,
	type LoggedEvent,
	planColumns,
	type RunRow,
	type RunState,
} from "../../../../log";
import type { NewRuns } from "../../application/ports";
import type { NewRun } from "../../application/start-run-here";

/**
 * The runs of this computer in memory: each started run's row and its
 * `RunStarted`, written together. A second start of one id fails, as the
 * row's key does, and writes nothing. A test puts the run a pin names
 * (`seed`) as the run log has it.
 */
export function inMemoryNewRuns() {
	const rows = new Map<string, RunRow>();
	const logs = new Map<string, LoggedEvent[]>();
	const seeded = new Map<
		string,
		{ run: Pick<RunRow, "projectId" | "spaceId">; state: RunState }
	>();
	let seq = 0;

	const twin = {
		/** The row of each run started here, by id. */
		rows,
		/** The events of a run started here, in order. */
		events(runId: string): LoggedEvent[] {
			return [...(logs.get(runId) ?? [])];
		},
		/** A run a pin may name: its project and Space, and its state. */
		seed(
			runId: string,
			run: { run: Pick<RunRow, "projectId" | "spaceId">; state: RunState },
		) {
			seeded.set(runId, run);
		},

		async started(run: NewRun) {
			if (rows.has(run.id) || seeded.has(run.id)) {
				throw new Error(`A run ${run.id} is there already.`);
			}
			const row: RunRow = {
				id: run.id,
				spaceId: run.spaceId,
				projectId: run.projectId,
				flowName: run.flowName,
				flow: JSON.stringify(run.flow),
				bodyFlows: JSON.stringify(run.calledFlows),
				flowRevision: run.flowRevision,
				bodyFlowRevisions: JSON.stringify(run.calledFlowRevisions),
				title: run.title,
				worktreePath: run.worktreePath,
				branch: run.branch,
				baseRef: run.baseRef,
				walkerId: run.walkerId,
				createdAt: asDate(0),
				...planColumns(run.plan),
			};
			const started = {
				seq: ++seq,
				runId: run.id,
				stepId: null,
				sessionId: null,
				type: "RunStarted",
				payload: run.started,
				at: 0,
			} as LoggedEvent;
			rows.set(run.id, row);
			logs.set(run.id, [started]);
			return row;
		},
		async pinned(runId: string) {
			const found = seeded.get(runId);
			if (found) return found;
			const row = rows.get(runId);
			if (!row) return null;
			return { run: row, state: foldRun(logs.get(runId) ?? []) };
		},
	};
	return twin satisfies NewRuns;
}

export type InMemoryNewRuns = ReturnType<typeof inMemoryNewRuns>;
