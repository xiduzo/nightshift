import { useSyncExternalStore } from "react";
import type { EditingSession, SessionState } from "./editing-session";

/** The session's state now: the component renders again on each change. */
export function useEditingSession(session: EditingSession): SessionState {
	return useSyncExternalStore(session.subscribe, session.get, session.get);
}
