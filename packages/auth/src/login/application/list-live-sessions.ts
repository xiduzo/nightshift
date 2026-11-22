import type { SessionStore } from "./ports";

export type ListLiveSessionsPorts = {
	sessionStore: Pick<SessionStore, "live">;
};

/** Which sessions, at which time. */
export type ListLiveSessions = { sessionIds: readonly string[]; at: number };

/**
 * Which of these sessions still work: the session exists and has not
 * expired. A phone's push target lives as long as its session. No
 * session asks nothing.
 */
export const listLiveSessions =
	(ports: ListLiveSessionsPorts) =>
	async (request: ListLiveSessions): Promise<Set<string>> => {
		if (request.sessionIds.length === 0) return new Set();
		return ports.sessionStore.live(request.sessionIds, request.at);
	};
