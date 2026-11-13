import { spacesOf } from "@nightshift/auth";
import {
	flowChanges,
	projectDashboard,
	spaceSpend,
	spacesDashboard,
	summarizeFlow,
} from "@nightshift/engine";
import { now } from "@nightshift/time";
import { z } from "zod";
import { output } from "../output";
import { protectedProcedure } from "../procedures";
import {
	dashboardSummarySchema,
	flowChangesSchema,
	flowHealthDetailSchema,
	nightRangeSchema,
	spaceSpendSchema,
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
			const read = { now: now(), timeZone: input.timeZone };
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
				"Computes the health of one flow of a project: its runs, where its work landed, its metrics, cost, problems and latest runs.",
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
				{ now: now(), timeZone: input.timeZone },
			),
		),
	/**
	 * Before and after for one flow of a project over the last `nights`
	 * days: the effect of its last change, the days against the days
	 * before, and the next changes to try.
	 */
	changes: protectedProcedure
		.route({
			summary:
				"Compares the runs of one flow before and after its last change, and over some days against the days before, and lists the next changes to try.",
		})
		.output(output(flowChangesSchema))
		.input(
			z.object({
				projectId: z.string(),
				flowName: z.string().min(1),
				nights: nightRangeSchema,
				timeZone: timeZoneSchema,
			}),
		)
		.handler(({ context, input }) =>
			flowChanges(
				context.space,
				{
					projectId: input.projectId,
					name: input.flowName,
					nights: input.nights,
				},
				{ now: now(), timeZone: input.timeZone },
			),
		),
	/** The Spend page of the session's Space. */
	spend: protectedProcedure
		.route({
			summary:
				"Computes what the runs of the Space cost, how steady the cost of each flow is, where a change saves money, and what Night Shift's own agents cost.",
		})
		.output(output(spaceSpendSchema))
		.input(z.object({ timeZone: timeZoneSchema }).default({ timeZone: "UTC" }))
		.handler(async ({ context, input }) =>
			spaceSpend(context.space, { now: now(), timeZone: input.timeZone }),
		),
};
