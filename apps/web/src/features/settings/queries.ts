/**
 * The query and mutation options of the settings of this computer.
 *
 * Verticals below settings (agents, flows, devices) read and save the
 * settings too. They import this file through a peer port
 * (`scripts/check-verticals.ts`), because the settings page imports them.
 */

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
