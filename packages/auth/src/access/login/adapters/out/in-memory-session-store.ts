import type { SessionStore } from "../../application/ports";

/** A session as the in-memory `SessionStore` keeps it. */
export type SessionRecord = { id: string; personId: string; expiresAt: number };

/**
 * `SessionStore` in memory. A test adds a session (`add`) where the real
 * adapter would find one.
 */
export function inMemorySessionStore() {
	const records = new Map<string, SessionRecord>();
	const twin = {
		records,
		/** How many times `live` was asked. */
		reads: 0,
		/** Adds a session, as the real adapter would find it. */
		add(record: SessionRecord) {
			records.set(record.id, record);
		},
		async end(personId: string, sessionId: string) {
			const found = records.get(sessionId);
			if (!found || found.personId !== personId) return false;
			records.delete(sessionId);
			return true;
		},
		async live(sessionIds: readonly string[], at: number) {
			twin.reads += 1;
			return new Set(
				sessionIds.filter((id) => {
					const found = records.get(id);
					return found !== undefined && found.expiresAt > at;
				}),
			);
		},
	};
	return twin satisfies SessionStore;
}

export type InMemorySessionStore = ReturnType<typeof inMemorySessionStore>;
