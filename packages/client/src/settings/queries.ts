import type { ApiQueryUtils } from "../api";

/** The query options of this computer's settings. */
export function createSettingsQueries(orpc: ApiQueryUtils) {
	return {
		/** The settings view: the values, where each comes from, and the daemon facts. */
		get: () => orpc.settings.get.queryOptions(),
		/** Saves a patch. A `null` value forgets the saved value. Answers with the new view. */
		save: orpc.settings.save.mutationOptions,
	};
}

/** The Ollama search by meaning and Decision nodes use: where it is, its models, a download. */
export function createOllamaQueries(orpc: ApiQueryUtils) {
	return {
		/**
		 * Whether it answers, has a model, and how far its download is: the
		 * embedding model, unless `model` names another.
		 */
		status: (model?: string) =>
			model
				? orpc.ollama.status.queryOptions({ input: { model } })
				: orpc.ollama.status.queryOptions(),
		/** The embedding models it has. */
		models: () => orpc.ollama.models.queryOptions(),
		/** Starts a download of a model, in the background. */
		pull: orpc.ollama.pull.mutationOptions,
	};
}
