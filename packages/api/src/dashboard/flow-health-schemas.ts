import { COST_STEADINESS } from "@nightshift/engine";
import { z } from "zod";

import {
	neededYouReasonSchema,
	runReportGlanceSchema,
	runResultSchema,
	runStatusSchema,
} from "../runs";
import { spreadSchema } from "./measure-schemas";

/**
 * The health of a flow: its row on a dashboard and the watch over it. The
 * outputs mirror the engine's types exactly (`exact`).
 */

const lastFlowRunSchema = z.object({
	runId: z.string(),
	status: runStatusSchema,
	startedAt: z.number(),
});

/**
 * A run's report as a list shows it: the run, the End step that wrote it,
 * when the run ended, how it came out, and the start of the report.
 */
export const latestReportSchema = runReportGlanceSchema.extend({
	runId: z.string(),
	endedAt: z.number(),
	result: runResultSchema,
});

/** The level of a flow: You decide, You check, On its own. */
const flowLevelSchema = z
	.object({ level: z.enum(["decide", "check", "own"]), since: z.number() })
	.nullable();

const attentionCountSchema = z.object({
	planned: z.number(),
	unplanned: z.number(),
});

/** One way a flow left its usual range. */
const flowSignalSchema = z.object({
	kind: z.enum(["failing", "nothing", "cost", "length", "slow"]),
	severe: z.boolean(),
	since: z.number(),
	runId: z.string(),
	count: z.number().optional(),
	now: z.number().optional(),
	usual: z.object({ low: z.number(), high: z.number() }).optional(),
});

/** The watch over one flow: its level, how often it needed a person, its signals. */
const flowWatchSchema = z.object({
	level: flowLevelSchema,
	attention: attentionCountSchema.extend({
		before: attentionCountSchema,
		causes: z.array(
			z.object({
				reason: neededYouReasonSchema,
				planned: z.boolean(),
				times: z.number(),
				nodeId: z.string().optional(),
				question: z.string().optional(),
			}),
		),
		perWeek: z.array(z.number()),
	}),
	length: spreadSchema.nullable(),
	signals: z.array(flowSignalSchema),
});

/** The watch over every flow of a dashboard. */
export const spaceWatchSchema = z.object({
	perWeek: z.array(z.number()),
	levels: z.object({
		decide: z.number(),
		check: z.number(),
		own: z.number(),
	}),
	watched: z.number(),
	flows: z.array(
		z.object({
			key: z.string(),
			projectId: z.string(),
			flow: z.string(),
			level: flowLevelSchema,
			signals: z.array(flowSignalSchema),
			lastAt: z.number(),
		}),
	),
});

export const flowHealthRowSchema = z.object({
	name: z.string(),
	last: lastFlowRunSchema.nullable(),
	lastRuns: z.array(lastFlowRunSchema),
	runs: z.number(),
	rate: z.number().nullable(),
	cost: spreadSchema.nullable(),
	tokenUse: spreadSchema.nullable(),
	unfinished: z.object({
		count: z.number(),
		costUsd: z.number(),
		tokens: z.number(),
	}),
	unknownCost: z.number(),
	freeRuns: z.number(),
	/** The newest report of its own runs. Absent: none. */
	report: latestReportSchema.optional(),
	watch: flowWatchSchema,
	/** How steady what a finished run costs and how long it works are. */
	steady: z.object({
		cost: z.enum(COST_STEADINESS).nullable(),
		time: z.enum(COST_STEADINESS).nullable(),
	}),
});
