import {
	createOllamaQueries,
	createSettingsQueries,
	createUsageQueries,
} from "@nightshift/client";
import { orpc } from "@/shared/api";

/** The query options of this computer's settings. Built on the shared factory. */
export const settingsQueries = createSettingsQueries(orpc);

/** Saves a patch of the settings. A `null` value forgets the saved value. */
export const settingsMutations = {
	save: settingsQueries.save,
};

/** Night Shift's own agents: the Builder, the Explainer, the Decider and the others. */
export const builtinQueries = {
	/** Who answers for each agent on this computer now, or why nothing can. */
	status: () => orpc.assistant.agents.queryOptions(),
};

/** The Ollama search by meaning and Decision nodes use. */
export const ollamaQueries = createOllamaQueries(orpc);

/** Starts a download of an Ollama model. */
export const ollamaMutations = {
	pull: ollamaQueries.pull,
};

/** Anonymous usage on this computer: what waits, the catalog, a new id. */
export const usageQueries = createUsageQueries(orpc);

/** Makes a new anonymous usage id. */
export const usageMutations = {
	resetId: usageQueries.resetId,
};
