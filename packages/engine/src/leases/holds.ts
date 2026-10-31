import { HostUnreachableError } from "../contract";
import type { RunHolds } from "../graph";
import { holdCovers, type LeaseHold, type RunLog } from "../log";
import { RunRefusal } from "../run-status";
import type { LeaseKeeper } from "./keeper";

/**
 * The leases of a run as the engine lets go of them and takes them back
 * (`RunHolds`):
 *
 * - On every end of the run they go. An interrupted run keeps them for
 *   its resume, and renews nothing until it continues, so a run that never
 *   does loses them after their ttl. One that does not continue lets go.
 * - A run that resumes takes back the leases it held when it ended, of
 *   the scopes its re-entry node is inside, and logs each again
 *   (`LeaseTaken` with `again`). Another run that holds one now refuses
 *   the resume. The keeper lets go of the leases the run held but does
 *   not take back (a run again from a node outside their Section).
 */
export function leaseHolds(deps: {
	keeper: Pick<LeaseKeeper, "take" | "release">;
	log: Pick<RunLog, "append">;
}): RunHolds {
	const { keeper } = deps;
	return {
		async ended(runId, status) {
			if (status === "interrupted") return;
			await keeper.release(runId);
		},
		notContinuing: (runId) => keeper.release(runId),
		async resuming(row, run, at) {
			const leases = run.endedHolding.filter(
				(hold): hold is LeaseHold => hold.kind === "lease",
			);
			if (leases.length === 0) return;
			const parentOf = (stepId: string) => {
				const step = run.steps.get(stepId);
				return step ? { nodeId: step.nodeId, scope: step.scope } : null;
			};
			const again = leases.filter((hold) => holdCovers(hold, at, parentOf));
			const left = leases.filter((hold) => !again.includes(hold));
			if (left.length > 0) {
				await keeper.release(
					row.id,
					left.map((hold) => hold.name),
				);
			}
			const taken: LeaseHold[] = [];
			for (const hold of again) {
				const answer = await keeper.take(row, {
					name: hold.name,
					ttlMinutes: hold.ttlMinutes,
				});
				if (answer.kind === "held") {
					taken.push(hold);
					continue;
				}
				if (taken.length > 0) {
					await keeper.release(
						row.id,
						taken.map((took) => took.name),
					);
				}
				if (answer.kind === "unreachable") throw new HostUnreachableError();
				throw new RunRefusal(
					"not-now",
					`The run "${answer.holder.runTitle}" holds the lease "${hold.name}" now. Resume this run when that run lets go of it.`,
				);
			}
			for (const hold of taken) {
				await deps.log.append({
					type: "LeaseTaken",
					runId: row.id,
					payload: {
						name: hold.name,
						nodeId: hold.nodeId,
						ttlMinutes: hold.ttlMinutes,
						scope: hold.scope,
						...(hold.section ? { section: hold.section } : {}),
						again: true,
					},
				});
			}
		},
	};
}
