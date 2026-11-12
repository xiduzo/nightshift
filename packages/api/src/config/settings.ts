import { DECIDER_SETUP } from "@nightshift/agents";
import {
	type SettingsStore,
	settingsPatchSchema,
	withEffectiveDecider,
} from "@nightshift/engine/device-config";

import type { Context } from "../context";
import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { settingsViewSchema } from "./schemas";

/**
 * The settings as the screens read them: an unsaved decider of new
 * Decision nodes is TypeSafe Jev with its key, else Ollama (Q22).
 */
function shown(
	view: ReturnType<SettingsStore["view"]>,
	context: Pick<Context, "connections" | "daemon">,
) {
	const typesafeKey =
		context.connections.secretSource(DECIDER_SETUP.typesafeKey) !== "missing";
	return {
		...withEffectiveDecider(view, typesafeKey),
		daemon: context.daemon,
	};
}

/** Daemon settings: saved in the database, else the environment, else the default. */
export const settings = {
	get: ownerProcedure
		.route({
			summary:
				"Reads every setting of this computer, where each value comes from, and facts about Night Shift here.",
		})
		.output(output(settingsViewSchema))
		.handler(({ context }) => shown(context.settings.view(), context)),
	/**
	 * A value saves it; null forgets it (back to the environment, then the
	 * default).
	 */
	save: ownerProcedure
		.route({
			summary:
				"Saves or forgets settings of this computer and returns them all.",
		})
		.output(output(settingsViewSchema))
		.input(settingsPatchSchema)
		.handler(async ({ context, input }) =>
			shown(await context.settings.save(input), context),
		),
};
