import type { Actor } from "../../../contract";
import type { StepDetail } from "../../../read";
import type { Access } from "../../access";
import type { RunViews } from "./ports";

export type ReadStepPorts = {
	views: Pick<RunViews, "getStep">;
	openRun: Access["openRun"];
};

/** Which step of which run, in which Space when the caller holds one. */
export type ReadStep = { runId: string; spaceId?: string; stepId: string };

/**
 * One step of a run with the prompt of each session and the element of
 * each item, for the actor: a run they may not see, and a step the run
 * does not have, are not found.
 */
export const readStep =
	(ports: ReadStepPorts) =>
	async (actor: Actor, request: ReadStep): Promise<StepDetail> => {
		const { stepId, ...which } = request;
		const { run } = await ports.openRun(actor, which);
		return ports.views.getStep(run, stepId);
	};
