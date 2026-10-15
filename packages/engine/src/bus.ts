import type { TranscriptEntry } from "./types";

/** What the engine publishes in-process for one run. */
export type BusItem =
	| { kind: "transcript"; entry: TranscriptEntry }
	/** The run's status may have changed. Listeners derive it again. */
	| { kind: "status-changed" };

type Listener = (item: BusItem) => void;

/** A synchronous in-process fan-out, keyed by run id. */
export function createRunBus() {
	const listeners = new Map<string, Set<Listener>>();

	return {
		subscribe(runId: string, listener: Listener): () => void {
			let set = listeners.get(runId);
			if (!set) {
				set = new Set();
				listeners.set(runId, set);
			}
			set.add(listener);
			return () => {
				const current = listeners.get(runId);
				if (!current) return;
				current.delete(listener);
				if (current.size === 0) listeners.delete(runId);
			};
		},
		publish(runId: string, item: BusItem): void {
			const set = listeners.get(runId);
			if (!set) return;
			for (const listener of [...set]) {
				try {
					listener(item);
				} catch {
					// A broken listener must not break the session that publishes.
				}
			}
		},
	};
}

export type RunBus = ReturnType<typeof createRunBus>;
