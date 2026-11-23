import type { SessionStore } from "./ports";

export type EndSessionPorts = {
	sessionStore: Pick<SessionStore, "end">;
};

/** Whose session, and which. */
export type EndSession = { personId: string; sessionId: string };

/**
 * Ends one of the Person's sessions: the screen that holds it is signed
 * out at its next call. Removing a phone ends the session it signed in
 * with. False when the Person has no session of that id.
 */
export const endSession =
	(ports: EndSessionPorts) =>
	async (request: EndSession): Promise<boolean> =>
		ports.sessionStore.end(request.personId, request.sessionId);
