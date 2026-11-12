/**
 * The query and mutation options of the settings of this computer.
 *
 * Verticals below settings (agents, flows, devices) read and save the
 * settings too. They import this file through a peer port
 * (`scripts/check-verticals.ts`), because the settings page imports them.
 */

import { createUsageQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const settingsQueries = {
	/** Every settings query. Invalidate it after a change. */
	all: () => orpc.settings.key(),
	/** The settings view: the values, where each comes from, and the daemon facts. */
	get: () => orpc.settings.get.queryOptions(),
};

export const settingsMutations = {
	/** Saves a patch. A `null` value forgets the saved value. Answers with the new view. */
	save: orpc.settings.save.mutationOptions,
};

const usage = createUsageQueries(orpc);

export const usageQueries = {
	/** Events waiting to send, and the last batch that was sent. */
	outbox: usage.outbox,
	/** The events that can be sent, and the fields of each. */
	catalog: usage.catalog,
};

export const usageMutations = {
	/** Gives this computer a new anonymous id. */
	resetId: usage.resetId,
};

/** The Ollama search by meaning and Decision nodes use: where it is, its models, a download. */
export const ollamaQueries = {
	/**
	 * Whether it answers, has a model, and how far its download is: the
	 * embedding model, unless `model` names another.
	 */
	/** Every Ollama query. Invalidate it after Ollama or a model changed. */
	all: () => orpc.ollama.key(),
	status: (model?: string) =>
		model
			? orpc.ollama.status.queryOptions({ input: { model } })
			: orpc.ollama.status.queryOptions(),
	/** The embedding models it has. */
	models: () => orpc.ollama.models.queryOptions(),
};

export const ollamaMutations = {
	/** Starts a download of a model, in the background. */
	pull: orpc.ollama.pull.mutationOptions,
};
