import type { Sessions } from "../sessions";
import { readProjectFacts } from "./adapters/out/project-facts";
import { suggestField } from "./application/suggest-field";

export function wireSuggestion(sessions: Sessions) {
	return {
		suggestField: suggestField({
			runReport: sessions.runReport,
			readProjectFacts,
		}),
	};
}
