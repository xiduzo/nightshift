import {
	firstNight,
	mix,
	mornings,
	nights,
	overview,
	retention,
} from "@nightshift/insights";

import { signedIn } from "@/shared/rpc";

import {
	emptyInput,
	firstNightSchema,
	mixSchema,
	morningsSchema,
	nightsSchema,
	overviewSchema,
	retentionSchema,
} from "./schemas";

/** The admin numbers. Each procedure requires a signed-in person. */
export const adminRouter = {
	overview: signedIn
		.route({
			summary:
				"Shows active installs, nights, merge rate, cost, and flagged installs.",
		})
		.input(emptyInput)
		.output(overviewSchema)
		.handler(({ context }) => overview(context.db)),
	firstNight: signedIn
		.route({
			summary:
				"Shows the setup steps, the time between them, and where installs stop.",
		})
		.input(emptyInput)
		.output(firstNightSchema)
		.handler(({ context }) => firstNight(context.db)),
	nights: signedIn
		.route({
			summary:
				"Shows runs per night, how runs end, and which guards stop them.",
		})
		.input(emptyInput)
		.output(nightsSchema)
		.handler(({ context }) => nights(context.db)),
	mornings: signedIn
		.route({
			summary: "Shows pull requests, gate answers, and phone or desktop.",
		})
		.input(emptyInput)
		.output(morningsSchema)
		.handler(({ context }) => mornings(context.db)),
	mix: signedIn
		.route({
			summary: "Shows agents, systems, desktop or Host, and versions.",
		})
		.input(emptyInput)
		.output(mixSchema)
		.handler(({ context }) => mix(context.db)),
	retention: signedIn
		.route({
			summary: "Shows weekly cohorts by the week of the first run.",
		})
		.input(emptyInput)
		.output(retentionSchema)
		.handler(({ context }) => retention(context.db)),
};
