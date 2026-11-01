import {
	cronError,
	describeCron,
	isTimeZone,
	nextCronTimes,
	scheduleSchema,
} from "@nightshift/flows";
import { now } from "@nightshift/time";
import { z } from "zod";
import { output } from "../output";
import { ownerProcedure, permitted, protectedProcedure } from "../procedures";
import { runSummarySchema } from "../runs";
import {
	cronPreviewSchema,
	scheduleIssueSchema,
	scheduleListSchema,
	schedulePauseSchema,
} from "./schemas";

/** The clock of the person who saves or reads a schedule, such as `Europe/Amsterdam`. */
const timeZoneSchema = z.string().refine(isTimeZone, {
	message: "Choose a time zone such as Europe/Amsterdam.",
});

/** One schedule of a project. */
const oneScheduleSchema = z.object({
	projectId: z.string(),
	scheduleId: z.string(),
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
	/**
	 * Pause tonight, a nudge and not an edit: the schedule's next start
	 * and every start until 06:00 after it, on the schedule's clock, start
	 * no run. Then it starts as before. A person who may stop runs may do
	 * it. The pause is in the schedule, so every Device and the Host see it.
	 */
	pauseTonight: permitted({ run: ["stop"] })
		.route({
			summary:
				"Skips a schedule's starts tonight, until the next morning, then it starts as before.",
		})
		.output(output(schedulePauseSchema))
		.input(oneScheduleSchema)
		.handler(async ({ context, input }) => {
			const pause = await context.space.pauseScheduleTonight(
				input.projectId,
				input.scheduleId,
			);
			await context.notifications.schedulesChanged(
				context.spaceId,
				input.projectId,
			);
			return pause;
		}),
	/** Ends a pause tonight: the schedule starts at its next time again. */
	resumeTonight: permitted({ run: ["stop"] })
		.route({
			summary:
				"Ends a schedule's pause tonight, so it starts at its next time again.",
		})
		.output(output(schedulePauseSchema))
		.input(oneScheduleSchema)
		.handler(async ({ context, input }) => {
			const pause = await context.space.resumeScheduleTonight(
				input.projectId,
				input.scheduleId,
			);
			await context.notifications.schedulesChanged(
				context.spaceId,
				input.projectId,
			);
			return pause;
		}),
	/**
	 * Run now, a nudge and not an edit: starts the schedule's run at once,
	 * as if it fired now, with the schedule as its trigger. A person who
	 * may start runs may do it. The run is the schedule's Person's, else
	 * the person's who asks. A pause tonight stays.
	 */
	runNow: permitted({ run: ["start"] })
		.route({
			summary:
				"Starts a schedule's run now, with its own inputs and Device, as if it fired.",
		})
		.output(output(runSummarySchema))
		.input(oneScheduleSchema)
		.handler(({ context, input }) =>
			context.space.runScheduleNow(input.projectId, input.scheduleId),
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
					: nextCronTimes(input.cron, now(), input.count ?? 3, input.timeZone),
			};
		}),
};
