import { settingsPatchSchema } from "@nightshift/engine";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { settingsViewSchema } from "./schemas";

/** Daemon settings: saved in the database, else the environment, else the default. */
export const settings = {
	get: ownerProcedure
		.route({
			summary:
				"Reads every setting of this computer, where each value comes from, and facts about Night Shift here.",
		})
		.output(output(settingsViewSchema))
		.handler(({ context }) => ({
			...context.settings.view(),
			daemon: context.daemon,
		})),
	/**
	 * A value saves it; null forgets it (back to the environment, then the
	 * default). The three notification switches also change the owner's
	 * own notification settings, until the Settings page saves those itself.
	 */
	save: ownerProcedure
		.route({
			summary:
				"Saves or forgets settings of this computer and returns them all.",
		})
		.output(output(settingsViewSchema))
		.input(settingsPatchSchema)
		.handler(async ({ context, input }) => {
			const view = await context.settings.save(input);
			const events = {
				gateOpened: view.values.notifyGateOpened,
				runFinished: view.values.notifyRunFinished,
				runFailed: view.values.notifyRunFailed,
			};
			const touched = (
				["notifyGateOpened", "notifyRunFinished", "notifyRunFailed"] as const
			).some((key) => input[key] !== undefined);
			if (touched) {
				await context.notifications.settings.save(context.session.user.id, {
					events,
				});
			}
			return { ...view, daemon: context.daemon };
		}),
};
