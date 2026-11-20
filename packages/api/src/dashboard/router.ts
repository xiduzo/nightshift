import { spacesOf } from "@nightshift/auth";
import { now } from "@nightshift/time";
import { z } from "zod";
import { output } from "../output";
import { protectedProcedure } from "../procedures";
import { flowChangesSchema } from "./changes-schemas";
import { flowHealthDetailSchema } from "./flow-health-schemas";
import { nightRangeSchema, timeZoneSchema } from "./measure-schemas";
import { spaceSpendSchema } from "./spend-schemas";
import { dashboardSummarySchema } from "./summary-schemas";

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
			const { dashboard } = context.engine;
			if (input.projectId !== undefined) {
				return dashboard.readProjectDashboard(context.actor, {
					spaceId: context.spaceId,
					projectId: input.projectId,
					...read,
				});
			}
			const personId = context.session.user.id;
			const spaceIds = input.everySpace
				? (await spacesOf(context.db, personId)).map((space) => space.id)
				: [context.spaceId];
			return dashboard.readSpacesDashboard(context.actor, {
				spaceIds,
				...read,
			});
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
		.handler(({ context, input }) =>
			context.engine.dashboard.readFlowHealth(context.actor, {
				spaceId: context.spaceId,
				projectId: input.projectId,
				flowName: input.flowName,
				now: now(),
				timeZone: input.timeZone,
			}),
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
			context.engine.dashboard.readFlowChanges(context.actor, {
				spaceId: context.spaceId,
				projectId: input.projectId,
				name: input.flowName,
				nights: input.nights,
				now: now(),
				timeZone: input.timeZone,
			}),
		),
	/** The Spend page of the session's Space. */
	spend: protectedProcedure
		.route({
			summary:
				"Computes what the runs of the Space cost, how steady the cost of each flow is, where a change saves money, and what Night Shift's own agents cost.",
		})
		.output(output(spaceSpendSchema))
		.input(z.object({ timeZone: timeZoneSchema }).default({ timeZone: "UTC" }))
		.handler(({ context, input }) =>
			context.engine.dashboard.readSpaceSpend(context.actor, {
				spaceId: context.spaceId,
				now: now(),
				timeZone: input.timeZone,
			}),
		),
};
