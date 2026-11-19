import { HostUnreachableError, type StartRunInput } from "../../../../contract";
import type { RunSummary } from "../../../../read";
import type { HostStarts } from "../../application/ports";

/**
 * The starts on a Host in memory. Each start the Host takes gets the id
 * `run-on-host-<n>`. A run arrives when a test says so (`arrive`). Without
 * a Host (`unreachable`), a start throws `HostUnreachableError`.
 */
export function inMemoryHostStarts() {
	const arrived = new Map<string, RunSummary>();
	let reachable = true;
	const twin = {
		/** Every start the Host took, in order. */
		started: [] as (StartRunInput & { spaceId: string })[],
		/** From now on no Host takes a start. */
		unreachable() {
			reachable = false;
		},
		/** The run reached this Replica: the run list shows it so. */
		arrive(runId: string, summary: RunSummary) {
			arrived.set(runId, summary);
		},

		async start(input: StartRunInput & { spaceId: string }) {
			if (!reachable) throw new HostUnreachableError();
			twin.started.push(input);
			return { runId: `run-on-host-${twin.started.length}` };
		},
		async arrived(run: { runId: string; spaceId: string; projectId: string }) {
			return arrived.get(run.runId) ?? null;
		},
	};
	return twin satisfies HostStarts;
}

export type InMemoryHostStarts = ReturnType<typeof inMemoryHostStarts>;
