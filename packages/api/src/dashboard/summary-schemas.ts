import type { DashboardSummary } from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";
import { runSummarySchema } from "../runs";
import {
	flowHealthRowSchema,
	latestReportSchema,
	spaceWatchSchema,
} from "./flow-health-schemas";
import { nightRangeSchema, topRows } from "./measure-schemas";

const nightsRangeSchema = z.object({
	nights: nightRangeSchema,
	/** The newest report of each flow, the newest end first. */
	reports: topRows(
		latestReportSchema.extend({
			key: z.string(),
			group: z.string(),
			title: z.string(),
		}),
	),
	flows: topRows(flowHealthRowSchema).nullable(),
});

/** The dashboard of the Space, of one project, or of every Space. */
export const dashboardSummarySchema = exact<DashboardSummary>()(
	z.object({
		nights: z.array(nightsRangeSchema),
		lastNight: z
			.object({
				latest: z.array(runSummarySchema.extend({ group: z.string() })),
			})
			.nullable(),
		flowHealth: topRows(flowHealthRowSchema).nullable(),
		watch: spaceWatchSchema,
	}),
);
