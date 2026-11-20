import type { Actor } from "../../contract";
import type { RunSummary } from "../../read";
import { type DashboardSummaryOf, summarizeDashboard } from "../measures";
import type { DashboardFlows, DashboardRuns } from "./ports";

/** The dashboard of a Space, a project or several Spaces, over the runs as the read model gives them. */
export type DashboardSummary = DashboardSummaryOf<RunSummary>;

export type ReadProjectDashboardPorts = {
	runs: Pick<DashboardRuns, "list">;
	flows: Pick<DashboardFlows, "list">;
};

/** The dashboard of one project of a Space: its runs, grouped by flow. `timeZone`: the reader's (IANA). */
export const readProjectDashboard =
	(ports: ReadProjectDashboardPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			now: number;
			timeZone: string;
		},
	): Promise<DashboardSummary> => {
		const { spaceId, projectId, now, timeZone } = request;
		const [runs, flows] = await Promise.all([
			ports.runs.list(actor, { spaceId, projectId }),
			ports.flows.list(actor, { spaceId, projectId }),
		]);
		return summarizeDashboard(runs, {
			now,
			timeZone,
			scope: { kind: "project", flows: flows.map((flow) => flow.name) },
		});
	};
