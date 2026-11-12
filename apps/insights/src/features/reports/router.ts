import {
	days,
	feedback,
	funnel,
	ladders,
	mix,
	overview,
	retention,
} from "@nightshift/insights";

import { signedIn } from "@/shared/rpc";

import {
	daysSchema,
	emptyInput,
	feedbackSchema,
	funnelSchema,
	laddersSchema,
	mixSchema,
	overviewSchema,
	retentionSchema,
} from "./schemas";

/** The admin numbers. Each procedure requires a signed-in person. */
export const adminRouter = {
	overview: signedIn
		.route({
			summary:
				"Shows active installs, days with runs, useful runs, cost, and flagged installs.",
		})
		.input(emptyInput)
		.output(overviewSchema)
		.handler(({ context }) => overview(context.db)),
	funnel: signedIn
		.route({
			summary:
				"Shows the setup steps, the time between them, and where installs stop.",
		})
		.input(emptyInput)
		.output(funnelSchema)
		.handler(({ context }) => funnel(context.db)),
	days: signedIn
		.route({
			summary: "Shows runs per day, how runs end, and which guards stop them.",
		})
		.input(emptyInput)
		.output(daysSchema)
		.handler(({ context }) => days(context.db)),
	feedback: signedIn
		.route({
			summary:
				"Shows useful runs, gate answers, phone or desktop, and pull requests.",
		})
		.input(emptyInput)
		.output(feedbackSchema)
		.handler(({ context }) => feedback(context.db)),
	ladders: signedIn
		.route({
			summary:
				"Shows where work and choices landed, what a landing cost, and how often a decider was not sure enough.",
		})
		.input(emptyInput)
		.output(laddersSchema)
		.handler(({ context }) => ladders(context.db)),
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
