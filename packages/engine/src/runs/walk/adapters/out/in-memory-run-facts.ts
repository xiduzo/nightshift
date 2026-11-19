import { foldRun, type LoggedEvent } from "../../../../log";
import type { RunFacts } from "../../application/ports";

/**
 * The facts of runs in memory: each run's events, folded as the run log
 * folds them (`foldRun`). It records what was appended and each change it
 * told, and a test can seed a run's log (`seed`) and set the clock (`at`).
 */
export function inMemoryRunFacts(walkerId = "this-computer") {
	const logs = new Map<string, LoggedEvent[]>();
	const watchers = new Map<string, Set<() => void>>();
	let seq = 0;
	let clock = 1_000;

	const twin = {
		/** Every event appended through the port, in order. */
		appended: [] as LoggedEvent[],
		/** The runs whose watchers were told of a change, in order. */
		changes: [] as string[],
		/** Puts events in a run's log as they are, before the test acts. */
		seed(runId: string, events: readonly LoggedEvent[]) {
			logs.set(runId, [...(logs.get(runId) ?? []), ...events]);
			for (const e of events) seq = Math.max(seq, e.seq);
		},
		/** The time the next append gets. */
		at(time: number) {
			clock = time;
		},
		/** Calls `listener` on each change of the run. Returns the unsubscribe. */
		watch(runId: string, listener: () => void): () => void {
			const set = watchers.get(runId) ?? new Set();
			watchers.set(runId, set);
			set.add(listener);
			return () => set.delete(listener);
		},

		async state(runId: string) {
			return foldRun(logs.get(runId) ?? []);
		},
		async events(runId: string) {
			return [...(logs.get(runId) ?? [])];
		},
		async append(event: Parameters<RunFacts["append"]>[0]) {
			const logged = {
				seq: ++seq,
				runId: event.runId,
				stepId: event.stepId ?? null,
				sessionId: event.sessionId ?? null,
				type: event.type,
				payload: event.payload,
				at: clock,
			} as LoggedEvent;
			logs.set(event.runId, [...(logs.get(event.runId) ?? []), logged]);
			twin.appended.push(logged);
			return logged;
		},
		changed(runId: string) {
			twin.changes.push(runId);
			for (const listener of [...(watchers.get(runId) ?? [])]) listener();
		},
		async walkerId() {
			return walkerId;
		},
	};
	return twin satisfies RunFacts;
}

export type InMemoryRunFacts = ReturnType<typeof inMemoryRunFacts>;
