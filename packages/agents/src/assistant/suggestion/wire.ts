import type { AssistantSessions } from "../application/ports";
import { suggestField } from "./application/suggest-field";

export function wireSuggestion(ports: {
	sessions: AssistantSessions;
}) {
	return {
		suggestField: suggestField({ sessions: ports.sessions }),
	};
}