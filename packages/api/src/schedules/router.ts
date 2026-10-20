import {
	cronError,
	describeCron,
	nextCronTimes,
	scheduleSchema,
} from "@nightshift/flows";
import { z } from "zod";

import { ownerProcedure, protectedProcedure } from "../procedures";

/** `.nightshift/schedules.json`: runs the daemon starts on a cron line. */
export const schedules = {
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listSchedules(input.projectId),
		),
	/**
	 * Replaces the whole file. Saves schedules with problems too. Returns the
	 * issues. Writes this computer's Clone: its owner's.
	 */
	save: ownerProcedure
		.input(
			z.object({ projectId: z.string(), schedules: z.array(scheduleSchema) }),
		)
		.handler(({ context, input }) =>
			context.space.saveSchedules(input.projectId, input.schedules),
		),
	/** The next times of a cron line on the daemon's clock, and how it reads. */
	preview: protectedProcedure
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
