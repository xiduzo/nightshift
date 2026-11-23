import type { Sessions } from "../../application/ports";
import { inMemoryTargetStore } from "./in-memory-target-store";

/**
 * The in-memory adapter of the port that another package fills
 * (`Sessions`, `@filledBy auth`), and `inMemoryTargetsPorts`, which gives
 * a use-case test every port of the slice at once. Test code: production
 * code never imports this file.
 */

/** The sessions of a test: each live until its end (ms). */
export function inMemorySessions() {
	const ends = new Map<string, { personId: string; endsAt: number }>();
	const sessions = {
		/** Every session that was ended, as `personId:sessionId`, in order. */
		ended: [] as string[],
		/** A session of the Person, live until `endsAt`. */
		add(sessionId: string, personId: string, endsAt: number) {
			ends.set(sessionId, { personId, endsAt });
		},
		async live(sessionIds: readonly string[], at: number) {
			return new Set(
				sessionIds.filter((id) => (ends.get(id)?.endsAt ?? 0) > at),
			);
		},
		async end(personId: string, sessionId: string) {
			sessions.ended.push(`${personId}:${sessionId}`);
			if (ends.get(sessionId)?.personId === personId) ends.delete(sessionId);
		},
	};
	return sessions satisfies Sessions;
}

/** Every port of targets in memory at once: where each use-case test starts. */
export function inMemoryTargetsPorts() {
	let ids = 0;
	const ports = {
		targetStore: inMemoryTargetStore(),
		sessions: inMemorySessions(),
		/** The time of the test, in ms. A test sets it. */
		time: 1_000,
		clock: () => ports.time,
		newId: () => `target-${++ids}`,
	};
	return ports;
}
