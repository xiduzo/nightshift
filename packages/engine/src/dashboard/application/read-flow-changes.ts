import type { Actor } from "../../contract";
import {
	type FlowChanges,
	lastDays,
	MOVE_RUNS,
	type NightRange,
	nextMoves,
	ownEndedRuns,
	summarizeChanges,
} from "../measures";
import type { DashboardFlows, DashboardRuns } from "./ports";

export type ReadFlowChangesPorts = {
	runs: DashboardRuns;
	flows: Pick<DashboardFlows, "revisions">;
};

/**
 * Before and after for one flow of a project over the last `nights` days:
 * its runs and its changes, and the next changes to try, read from the
 * steps of its newest runs of the days. A flow without revisions (a
 * removed one) has no changes.
 */
export const readFlowChanges =
	(ports: ReadFlowChangesPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
			nights: NightRange;
			now: number;
			timeZone: string;
		},
	): Promise<FlowChanges> => {
		const { spaceId, projectId, name, nights, now, timeZone } = request;
		const [all, revisions] = await Promise.all([
			ports.runs.list(actor, { spaceId, projectId }),
			(async () =>
				ports.flows.revisions(actor, { spaceId, projectId, name }))().catch(
				() => [],
			),
		]);
		const runs = ownEndedRuns(name, all);
		const start = lastDays(nights, now, timeZone)[0] ?? now;
		const recent = runs
			.filter((run) => run.createdAt >= start)
			.slice(-MOVE_RUNS);
		const details = (
			await Promise.allSettled(
				recent.map((run) => ports.runs.get(actor, { spaceId, runId: run.id })),
			)
		).flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		);
		return summarizeChanges(runs, revisions, {
			now,
			timeZone,
			nights,
			moves: nextMoves(details),
			read: details.length,
		});
	};
