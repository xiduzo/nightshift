import type { Sessions } from "../sessions";
import { folderProjectFactsReader } from "./adapters/out/folder-project-facts-reader";
import { suggestField } from "./application/suggest-field";

export function wireSuggestion(sessions: Sessions) {
	return {
		suggestField: suggestField({
			runReport: sessions.runReport,
			readProjectFacts: folderProjectFactsReader,
		}),
	};
}
