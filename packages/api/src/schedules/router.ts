import {
	cronError,
	describeCron,
	nextCronTimes,
	scheduleSchema,
} from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure, protectedProcedure } from "../procedures";
import {
	cronPreviewSchema,
	scheduleIssueSchema,
	scheduleListSchema,
} from "./schemas";

/** `.nightshift/schedules.json`: runs the daemon starts on a cron line. */
export const schedules = {
	list: protectedProcedure
		.route({
			summary:
				"Lists the schedules of a project, with the next start and how the last one went.",
		})
		.output(output(scheduleListSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listSchedules(input.projectId),
		),
	/**
	 * Replaces the whole file. Saves schedules with problems too. Returns the
	 * issues. Writes this computer's Clone: its owner's.
	 */
	save: ownerProcedure
		.route({
			summary:
				"Replaces the schedules of a project, also with problems, and returns the problems.",
		})
		.output(output(z.array(scheduleIssueSchema)))
		.input(
			z.object({ projectId: z.string(), schedules: z.array(scheduleSchema) }),
		)
		.handler(({ context, input }) =>
			context.space.saveSchedules(input.projectId, input.schedules),
		),
	/** The next times of a cron line on the daemon's clock, and how it reads. */
	preview: protectedProcedure
		.route({
			summary:
				"Reads a cron line: how it reads, and its next times on this computer's clock.",
		})
		.output(output(cronPreviewSchema))
		.input(
			z.object({
				cron: z.string(),
				count: z.number().int().min(1).max(10).optional(),
			}),
		)
		.handler(({ input }) => {
			const error = cronError(input.cron);
			return {
				error,
				description: error ? null : describeCron(input.cron),
				times: error
					? []
					: nextCronTimes(input.cron, Date.now(), input.count ?? 3),
			};
		}),
};
