import type { Runner } from "../../../../graph";
import type { Turns } from "../../application/ports";

/** The Turns of the runs this computer walks: the runner fits the port as it is. */
export function runnerTurns(runner: Runner): Turns {
	return {
		take: (runId, intent, options) => runner.take(runId, intent, options),
		hold: (runId, work, options) => runner.hold(runId, work, options),
		forget: (runId) => runner.forget(runId),
		isActive: (runId) => runner.isActive(runId),
		restore: (runId, state) => runner.restore(runId, state),
		continueTranscriptAfter: (runId, seq) =>
			runner.continueTranscriptAfter(runId, seq),
	};
}
