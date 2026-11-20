import type { Actor } from "../../contract";
import { type FlowHealthDetail, summarizeFlow } from "../measures";
import type { DashboardRuns } from "./ports";

export type ReadFlowHealthPorts = { runs: Pick<DashboardRuns, "list"> };

/** One flow of a project, behind its Flow health row: its runs, where its work landed, its metrics, cost and problems. */
export const readFlowHealth =
	(ports: ReadFlowHealthPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			flowName: string;
			now: number;
			timeZone: string;
		},
	): Promise<FlowHealthDetail> => {
		const { spaceId, projectId, flowName, now, timeZone } = request;
		return summarizeFlow(
			flowName,
			await ports.runs.list(actor, { spaceId, projectId }),
			{ now, timeZone },
		);
	};
