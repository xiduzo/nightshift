import type { Actor } from "../../contract";
import { type FlowSignal, turnedSevere, watchRunsOf } from "../measures";
import type { DashboardRuns } from "./ports";

/** A flow that turned severe under Needs a look, and the run that turned it. */
export type SevereTurn = {
	projectId: string;
	/** The flow's name. */
	flow: string;
	/** The run whose end turned it severe: the newest that shows it. */
	runId: string;
	/** The severe signal. */
	signal: FlowSignal;
};

export type ReadSevereTurnPorts = { runs: DashboardRuns };

/**
 * Whether the end of one run turned its flow severe under Needs a look:
 * the same watch as the dashboard, over the flow's own real runs. Null
 * for a quick run, a test run, a run this Replica does not have, and a
 * flow that was severe already or is not severe now.
 */
export const readSevereTurn =
	(ports: ReadSevereTurnPorts) =>
	async (
		actor: Actor,
		request: { spaceId: string; runId: string; now: number },
	): Promise<SevereTurn | null> => {
		const { spaceId, runId, now } = request;
		const run = await ports.runs
			.get(actor, { spaceId, runId })
			.catch(() => null);
		if (!run?.flowName) return null;
		const runs = watchRunsOf(
			run.flowName,
			await ports.runs.list(actor, { spaceId, projectId: run.projectId }),
			now,
		);
		const signal = turnedSevere(runs, runId);
		return signal
			? { projectId: run.projectId, flow: run.flowName, runId, signal }
			: null;
	};
