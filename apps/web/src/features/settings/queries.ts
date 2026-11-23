import {
	createOllamaQueries,
	createSettingsQueries,
} from "@nightshift/client";
import { orpc } from "@/shared/api";

/** The query options of this computer's settings. Built on the shared factory. */
export const settingsQueries = createSettingsQueries(orpc);

/** Saves a patch of the settings. A `null` value forgets the saved value. */
export const settingsMutations = {
	save: settingsQueries.save(),
};

/** The Ollama search by meaning and Decision nodes use. */
export const ollamaQueries = createOllamaQueries(orpc);

/** Starts a download of an Ollama model. */
export const ollamaMutations = {
	pull: ollamaQueries.pull(),
};
