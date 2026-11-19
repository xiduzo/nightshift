import type { Actor } from "../../../contract";
import type { StepTranscript } from "../../../read";
import type { Access } from "../../access";
import type { RunViews } from "./ports";

export type ReadStepTranscriptPorts = {
	views: Pick<RunViews, "stepTranscript">;
	openRun: Access["openRun"];
};

/** Which step of which run, and the signal that ends the read with what came. */
export type ReadStepTranscript = {
	runId: string;
	spaceId?: string;
	stepId: string;
	signal: AbortSignal;
};

/**
 * One step's transcript as Night Shift saved it, for the actor: all of it
 * once the step ended, what this computer keeps so far while it runs. A
 * run they may not see is not found.
 */
export const readStepTranscript =
	(ports: ReadStepTranscriptPorts) =>
	async (
		actor: Actor,
		request: ReadStepTranscript,
	): Promise<StepTranscript> => {
		const { stepId, signal, ...which } = request;
		const { run } = await ports.openRun(actor, which);
		return ports.views.stepTranscript(run, stepId, signal);
	};
