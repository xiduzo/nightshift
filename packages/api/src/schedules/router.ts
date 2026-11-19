import { ROLE_REFUSAL, RoleRefusal } from "@nightshift/auth";
import { SpaceNotFound } from "@nightshift/engine";
import { isTimeZone, scheduleSchema } from "@nightshift/flows";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { output } from "../output";
import { ownerOnly, protectedProcedure, refusalError } from "../procedures";
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

/**
 * A procedure on the schedules of the session's Space. The engine checks
 * the Person's role there, in the use case. This says its refusals as the
 * API said them before: a role that does not allow the request is
 * `ROLE_REFUSAL` (403), a Space they are not a Member of is not found.
 */
const scheduleProcedure = protectedProcedure.use(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (error instanceof RoleRefusal) throw refusalError(ROLE_REFUSAL);
		if (error instanceof SpaceNotFound) {
			throw new ORPCError("NOT_FOUND", {
				message: error.message,
				cause: error,
			});
		}
		throw error;
	}
});

/** One schedule of a project. */
const oneScheduleSchema = z.object({
	projectId: z.string(),
	scheduleId: z.string(),
});

/** A project's schedules: runs Night Shift starts at a cron time or on a webhook. */
export const schedules = {
	list: scheduleProcedure
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
	save: scheduleProcedure
		.use(ownerOnly)
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
	 * it: the engine checks their role. The pause is in the schedule, so
	 * every Device and the Host see it.
	 */
	pauseTonight: scheduleProcedure
		.route({
			summary:
				"Skips a schedule's starts tonight, until the next morning, then it starts as before.",
		})
		.output(output(schedulePauseSchema))
		.input(oneScheduleSchema)
		.handler(({ context, input }) =>
			context.space.pauseScheduleTonight(input.projectId, input.scheduleId),
		),
	/**
	 * Ends a pause tonight: the schedule starts at its next time again. A
	 * person who may stop runs may do it: the engine checks their role.
	 */
	resumeTonight: scheduleProcedure
		.route({
			summary:
				"Ends a schedule's pause tonight, so it starts at its next time again.",
		})
		.output(output(schedulePauseSchema))
		.input(oneScheduleSchema)
		.handler(({ context, input }) =>
			context.space.resumeScheduleTonight(input.projectId, input.scheduleId),
		),
	/**
	 * Run now, a nudge and not an edit: starts the schedule's run at once,
	 * as if it fired now, with the schedule as its trigger. A person who
	 * may start runs may do it. The run is the schedule's Person's, else
	 * the person's who asks. A pause tonight stays. The engine checks that
	 * the person's role allows starting runs.
	 */
	runNow: scheduleProcedure
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
		.handler(({ context, input }) => context.space.previewCron(input)),
};
