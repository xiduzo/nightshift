import { readProjectFacts } from "./adapters/out/project-facts";
import type { SuggestSessions } from "./application/ports";
import { suggestField } from "./application/suggest-field";

export function wireSuggestion(ports: { sessions: SuggestSessions }) {
	return {
		suggestField: suggestField({
			sessions: ports.sessions,
			readProjectFacts,
		}),
	};
}
