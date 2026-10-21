import { spacesOf } from "@nightshift/auth";
import {
	type DashboardScope,
	type SpaceEngine,
	summarizeDashboard,
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

/** Every project of `spaces`, by id: its name, to group runs by project. */
async function projectNames(
	spaces: SpaceEngine[],
): Promise<Map<string, string>> {
	const lists = await Promise.all(spaces.map((space) => space.listProjects()));
	return new Map(lists.flat().map((project) => [project.id, project.name]));
}

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
			const actor = { personId: context.session.user.id };
			const now = Date.now();
			const { projectId, timeZone } = input;
			if (projectId !== undefined) {
				const [runs, flows] = await Promise.all([
					context.space.listRuns({ projectId }),
					context.space.listFlows(projectId),
				]);
				return summarizeDashboard(runs, {
					now,
					timeZone,
					scope: { kind: "project", flows: flows.map((flow) => flow.name) },
				});
			}
			const spaces = input.everySpace
				? (await spacesOf(context.db, context.session.user.id)).map((space) =>
						context.engine.space(space.id, actor),
					)
				: [context.space];
			const [runs, names] = await Promise.all([
				Promise.all(spaces.map((space) => space.listRuns())),
				projectNames(spaces),
			]);
			const scope: DashboardScope = { kind: "all", projectNames: names };
			return summarizeDashboard(runs.flat(), {
				now,
				timeZone,
				scope,
			});
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
