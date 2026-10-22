import { spacesOf } from "@nightshift/auth";
import {
	projectDashboard,
	spacesDashboard,
	summarizeFlow,
} from "@nightshift/engine";
import { z } from "zod";

import { output } from "../output";
import { protectedProcedure } from "../procedures";
import {
	dashboardSummarySchema,
	flowHealthDetailSchema,
	timeZoneSchema,
} from "./schemas";

/**
 * The dashboard's numbers, computed from the runs here, so the web app and
 * the phone show the same ones without loading every run.
 */
export const dashboard = {
	/**
	 * Over the session's Space, over one project in it (`projectId`), or over
	 * every Space the Person is in (`everySpace`). One project is in one
	 * Space, so `everySpace` does nothing with `projectId`.
	 */
	summary: protectedProcedure
		.route({
			summary:
				"Computes the dashboard of the Space, of one project, or of every Space you are in.",
		})
		.output(output(dashboardSummarySchema))
		.input(
			z
				.object({
					projectId: z.string().optional(),
					timeZone: timeZoneSchema,
					everySpace: z.boolean().optional(),
				})
				.default({ timeZone: "UTC" }),
		)
		.handler(async ({ context, input }) => {
			const read = { now: Date.now(), timeZone: input.timeZone };
			if (input.projectId !== undefined) {
				return projectDashboard(context.space, input.projectId, read);
			}
			const personId = context.session.user.id;
			const spaces = input.everySpace
				? (await spacesOf(context.db, personId)).map((space) =>
						context.engine.space(space.id, { personId }),
					)
				: [context.space];
			return spacesDashboard(spaces, read);
		}),
	/** One flow of a project, behind its Flow health row. */
	flow: protectedProcedure
		.route({
			summary:
				"Computes the health of one flow of a project: its runs, cost, problems and latest runs.",
		})
		.output(output(flowHealthDetailSchema))
		.input(
			z.object({
				projectId: z.string(),
				flowName: z.string().min(1),
				timeZone: timeZoneSchema,
			}),
		)
		.handler(async ({ context, input }) =>
			summarizeFlow(
				input.flowName,
				await context.space.listRuns({ projectId: input.projectId }),
				{ now: Date.now(), timeZone: input.timeZone },
			),
		),
};
