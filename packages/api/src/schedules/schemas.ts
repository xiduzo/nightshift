import type { ScheduleList, SchedulePause } from "@nightshift/engine";
import { type ScheduleIssue, scheduleSchema } from "@nightshift/flows";
import { z } from "zod";

import { exact } from "../output";
import { runStatusSchema } from "../runs";

/** One problem in the schedules file. A schedule with an error does not start. */
export const scheduleIssueSchema = exact<ScheduleIssue>()(
	z.object({
		severity: z.enum(["error", "warning"]),
		message: z.string(),
		/** Absent for problems of the whole file. */
		scheduleId: z.string().optional(),
	}),
);

/** The schedules of a project, with the next start and how the last one went. */
export const scheduleListSchema = exact<ScheduleList>()(
	z.object({
		path: z.string(),
		schedules: z.array(
			scheduleSchema.extend({
				nextAt: z.number().nullable(),
				last: z
					.discriminatedUnion("kind", [
						z.object({
							kind: z.literal("fired"),
							at: z.number(),
							runId: z.string(),
							runStatus: runStatusSchema.nullable(),
						}),
						z.object({
							kind: z.literal("failed"),
							at: z.number(),
							error: z.string(),
						}),
						z.object({
							kind: z.literal("skipped"),
							at: z.number(),
							reason: z.string(),
							runId: z.string().nullable(),
						}),
					])
					.nullable(),
				deliveries: z.array(
					z.object({
						at: z.number(),
						result: z.enum(["accepted", "filtered", "refused"]),
						reason: z.string().nullable(),
						runId: z.string().nullable(),
						woke: z.number(),
					}),
				),
				issues: z.array(scheduleIssueSchema),
			}),
		),
		issues: z.array(scheduleIssueSchema),
	}),
);

/** A schedule's pause tonight after a change, and its next start with it. */
export const schedulePauseSchema = exact<SchedulePause>()(
	z.object({
		/** When the pause ends (epoch ms). Null: not paused. */
		pausedUntil: z.number().nullable(),
		/** The next start (epoch ms), after the pause. Null when off. */
		nextAt: z.number().nullable(),
	}),
);

/** How a cron line reads, and its next times. */
export const cronPreviewSchema = z.object({
	/** Why the cron line is not valid. Null when it is. */
	error: z.string().nullable(),
	description: z.string().nullable(),
	/** Epoch ms. */
	times: z.array(z.number()),
});
