import type { RunHolds } from "../graph";
import type { LeaseKeeper } from "./keeper";

/**
 * The leases of a run as the engine lets go of them (`RunHolds`): on every
 * end of the run, and when an interrupted run does not continue. An
 * interrupted run keeps them for its resume, and renews nothing until it
 * continues, so a run that never does loses them after their ttl.
 */
export function leaseHolds(keeper: Pick<LeaseKeeper, "release">): RunHolds {
	return {
		async ended(runId, status) {
			if (status === "interrupted") return;
			await keeper.release(runId);
		},
		notContinuing: (runId) => keeper.release(runId),
	};
}
