import type { RunLeases } from "../../application/ports";

/**
 * The leases of runs in memory: one run holds a name at a time. A test
 * gives a run a lease (`take`) and reads who holds a name (`holder`). It
 * records each release it was asked for.
 */
export function inMemoryRunLeases() {
	const holders = new Map<string, string>();

	const twin = {
		/** Every release asked for, in order. */
		released: [] as { runId: string; names: readonly string[] }[],
		/** The run takes the lease `name`: true when it holds it now. */
		take(runId: string, name: string): boolean {
			const holder = holders.get(name);
			if (holder !== undefined && holder !== runId) return false;
			holders.set(name, runId);
			return true;
		},
		/** The run that holds the lease `name`, or null. */
		holder(name: string): string | null {
			return holders.get(name) ?? null;
		},

		async release(runId: string, names: readonly string[]) {
			twin.released.push({ runId, names });
			for (const name of names) {
				if (holders.get(name) === runId) holders.delete(name);
			}
		},
	};
	return twin satisfies RunLeases;
}

export type InMemoryRunLeases = ReturnType<typeof inMemoryRunLeases>;
