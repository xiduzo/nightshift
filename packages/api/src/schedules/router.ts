import {
	cronError,
	describeCron,
	isTimeZone,
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

/** The clock of the person who saves or reads a schedule, such as `Europe/Amsterdam`. */
const timeZoneSchema = z.string().refine(isTimeZone, {
	message: "Choose a time zone such as Europe/Amsterdam.",
});

/** A project's schedules: runs Night Shift starts at a cron time or on a webhook. */
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
	 * issues. Writes this computer's Clone: its owner's. `timeZone` is the
	 * saver's clock: a schedule with a time and no time zone gets it.
	 */
	save: ownerProcedure
		.route({
			summary:
				"Replaces the schedules of a project, also with problems, and returns the problems.",
		})
		.output(output(z.array(scheduleIssueSchema)))
		.input(
			z.object({
				projectId: z.string(),
				schedules: z.array(scheduleSchema),
				timeZone: timeZoneSchema.optional(),
			}),
		)
		.handler(({ context, input }) =>
			context.space.saveSchedules(
				input.projectId,
				input.schedules,
				input.timeZone,
			),
		),
	/** The next times of a cron line on the clock of `timeZone` (default: this computer's), and how it reads. */
	preview: protectedProcedure
		.route({
			summary:
				"Reads a cron line: how it reads, and its next times on the given clock.",
		})
		.output(output(cronPreviewSchema))
		.input(
			z.object({
				cron: z.string(),
				count: z.number().int().min(1).max(10).optional(),
				timeZone: timeZoneSchema.optional(),
			}),
		)
		.handler(({ input }) => {
			const error = cronError(input.cron);
			return {
				error,
				description: error ? null : describeCron(input.cron),
				times: error
					? []
					: nextCronTimes(
							input.cron,
							Date.now(),
							input.count ?? 3,
							input.timeZone,
						),
			};
		}),
};
