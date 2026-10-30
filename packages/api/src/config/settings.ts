import { settingsPatchSchema } from "@nightshift/engine/device-config";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { settingsViewSchema } from "./schemas";

/** The names of the export's headers. Their values never leave this computer's keychain. */
const telemetryHeadersSchema = z.object({ names: z.array(z.string()) });

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
	 * default).
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
			return { ...view, daemon: context.daemon };
		}),
	/** The headers of the export to monitoring: their names, never their values. */
	telemetryHeaders: ownerProcedure
		.route({
			summary:
				"Reads the names of the headers this computer sends to your monitoring.",
		})
		.output(output(telemetryHeadersSchema))
		.handler(async ({ context }) => ({
			names: await context.telemetry.headers.names(),
		})),
	/**
	 * Keeps the headers of the export (`name=value`, one per line) in place
	 * of the ones before, like a secret. Null or empty forgets them.
	 */
	saveTelemetryHeaders: ownerProcedure
		.route({
			summary:
				"Saves or forgets the headers this computer sends to your monitoring, and returns their names.",
		})
		.input(z.object({ headers: z.string().max(8_000).nullable() }))
		.output(output(telemetryHeadersSchema))
		.handler(async ({ context, input }) => ({
			names: await context.telemetry.headers.save(input.headers),
		})),
};
