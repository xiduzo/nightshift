import { settingsPatchSchema } from "@nightshift/engine";

import { ownerProcedure } from "../procedures";

/** Daemon settings: saved in the database, else the environment, else the default. */
export const settings = {
	get: ownerProcedure.handler(({ context }) => ({
		...context.settings.view(),
		daemon: context.daemon,
	})),
	/** A value saves it; null forgets it (back to the environment, then the default). */
	save: ownerProcedure
		.input(settingsPatchSchema)
		.handler(async ({ context, input }) => ({
			...(await context.settings.save(input)),
			daemon: context.daemon,
		})),
};
