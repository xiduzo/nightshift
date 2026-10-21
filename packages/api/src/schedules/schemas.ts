import type { ScheduleList } from "@nightshift/engine";
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
				issues: z.array(scheduleIssueSchema),
			}),
		),
		issues: z.array(scheduleIssueSchema),
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
