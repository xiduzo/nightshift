import { isTimeZone } from "@nightshift/engine";
import { z } from "zod";

/**
 * What every dashboard schema measures with: the reader's time zone, the
 * ranges of days, a spread and the first rows of a list.
 */

/** The reader's time zone: where a day's midnight falls. Default UTC. */
export const timeZoneSchema = z
	.string()
	.refine(isTimeZone, {
		message: "Choose a time zone such as Europe/Amsterdam.",
	})
	.default("UTC");

export const nightRangeSchema = z.literal([7, 30, 90]);

export const spreadSchema = z.object({
	min: z.number(),
	q1: z.number(),
	median: z.number(),
	q3: z.number(),
	max: z.number(),
	count: z.number(),
});

export const topRows = <T extends z.ZodType>(row: T) =>
	z.object({ rows: z.array(row), count: z.number() });
