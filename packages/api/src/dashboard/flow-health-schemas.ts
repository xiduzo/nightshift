import {
	COST_STEADINESS,
	type FlowHealthDetail,
	RUNGS,
} from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";
import {
	ladderSchema,
	neededYouReasonSchema,
	rungBySchema,
	runReportGlanceSchema,
	runResultSchema,
	runStatusSchema,
} from "../runs";
import {
	knownCostSchema,
	nightCountsSchema,
	nightRangeSchema,
	spreadSchema,
	statusCountSchema,
	topRows,
} from "./measure-schemas";

/**
 * The health of a flow: its row on a dashboard, with its scores, its
 * ladders and its watch, and the flow in detail. The outputs mirror the
 * engine's types exactly (`exact`).
 */

const lastFlowRunSchema = z.object({
	runId: z.string(),
	status: runStatusSchema,
	startedAt: z.number(),
});

/** One score name of a flow's runs. A flow chooses its own names. */
const flowScoreRowSchema = z.object({
	name: z.string(),
	runs: z.number(),
	count: z.number(),
	sum: z.number(),
	mean: z.number(),
	latest: z.object({ value: z.number(), at: z.number(), runId: z.string() }),
});

/** Why runs needed you: one reason, and how many runs had it. */
export const neededReasonCountSchema = z.object({
	reason: neededYouReasonSchema,
	runs: z.number(),
});

/** How often a flow's own runs needed you, and why. */
const flowNeededYouSchema = z.object({
	runs: z.number(),
	needed: z.number(),
	reasons: z.array(neededReasonCountSchema),
});

/** What people answered to "Was this run useful?" about a flow's own runs. */
const flowUsefulSchema = z.object({
	answered: z.number(),
	useful: z.number(),
	costPerUseful: knownCostSchema.nullable(),
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

/**
 * One rung of a flow's ladder: how often a climb landed on it, and what a
 * landing there cost on average, every try before it included. `tier` is
 * null on a person, a deadline, a rule, `none`, and a node without a
 * Cascade (`by` names it).
 */
const ladderRungRowSchema = z.object({
	rung: z.enum(RUNGS),
	by: rungBySchema,
	tier: z.string().nullable(),
	landed: z.number(),
	costPerLanding: knownCostSchema,
});

/** Where the climbs of one ladder landed, the cheapest rung first. */
const ladderSummarySchema = z.object({
	landed: z.number(),
	rungs: z.array(ladderRungRowSchema),
});

/**
 * Where the work of a flow's own runs landed: the work ladder and the
 * choice ladder, with how often a decider gave a probability (`picked`)
 * and was not sure enough (`unsure`). Null: nothing landed on it.
 */
const flowLaddersSchema = z.object({
	work: ladderSummarySchema.nullable(),
	choice: ladderSummarySchema
		.extend({ picked: z.number(), unsure: z.number() })
		.nullable(),
});

/** One node's ladder: `via` names the Subflow nodes it ran in. */
const nodeLadderSchema = z.object({
	key: z.string(),
	ladder: ladderSchema,
	nodeId: z.string(),
	via: z.string().optional(),
	landed: z.number(),
	costPerLanding: knownCostSchema,
	rungs: z.array(ladderRungRowSchema),
	picked: z.number().optional(),
	unsure: z.number().optional(),
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
	finished: z.number(),
	ended: z.number(),
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
	scores: z.array(flowScoreRowSchema),
	useful: flowUsefulSchema,
	neededYou: flowNeededYouSchema,
	/** The newest report of its own runs. Absent: none. */
	report: latestReportSchema.optional(),
	/** Where the work of its own runs landed. */
	ladders: flowLaddersSchema,
	watch: flowWatchSchema,
	/** How steady what a finished run costs and how long it works are. */
	steady: z.object({
		cost: z.enum(COST_STEADINESS).nullable(),
		time: z.enum(COST_STEADINESS).nullable(),
	}),
});

const flowRunSchema = z.object({
	runId: z.string(),
	status: runStatusSchema,
	startedAt: z.number(),
	endedAt: z.number().nullable(),
	costUsd: z.number(),
	calledBy: z.string().nullable(),
	reason: z.string().nullable(),
	costEstimated: z.boolean(),
	costMissing: z.number(),
	costCalls: z.number(),
	tokens: z.number().nullable(),
	warnings: z.number(),
});

/** One flow of a project in detail, per range of days. */
export const flowHealthDetailSchema = exact<FlowHealthDetail>()(
	z.object({
		name: z.string(),
		ranges: z.array(
			z.object({
				nights: nightRangeSchema,
				runs: z.number(),
				asSubflow: z.number(),
				ended: z.number(),
				finished: z.number(),
				unfinished: z.number(),
				cost: spreadSchema.nullable(),
				tokenUse: spreadSchema.nullable(),
				length: spreadSchema.nullable(),
				spent: knownCostSchema,
				spentTokens: z.number(),
				// Test runs: only the spend counts them.
				tests: z.number(),
				spentUnfinished: knownCostSchema,
				unfinishedTokens: z.number(),
				dearest: z
					.object({
						costUsd: z.number(),
						startedAt: z.number(),
						tokens: z.number().nullable(),
					})
					.nullable(),
				warnings: z.number(),
				statuses: z.array(statusCountSchema),
				perNight: z.array(
					nightCountsSchema.extend({
						spent: knownCostSchema,
						needed: z.object({ runs: z.number(), needed: z.number() }),
						/** Per metric name: the sum its runs wrote that day, and how many runs wrote it. */
						metrics: z.record(
							z.string(),
							z.object({ sum: z.number(), runs: z.number() }),
						),
					}),
				),
				endedRuns: z.array(
					z.object({
						runId: z.string(),
						startedAt: z.number(),
						night: z.number(),
						costUsd: z.number(),
						tokens: z.number().nullable(),
						status: runStatusSchema,
					}),
				),
				whyUnfinished: topRows(
					z.object({
						reason: z.string().nullable(),
						status: runStatusSchema,
						calledBy: z.string().nullable(),
						runs: z.number(),
						lastAt: z.number(),
					}),
				),
				warningRows: topRows(
					z.object({
						key: z.string(),
						nodeId: z.string().nullable(),
						message: z.string(),
						runs: z.number(),
						last: z.object({ runId: z.string(), at: z.number() }),
					}),
				),
				scores: z.array(flowScoreRowSchema),
				useful: flowUsefulSchema,
				neededYou: flowNeededYouSchema,
				/** Where the work of its own runs landed. */
				ladders: flowLaddersSchema.extend({ nodes: topRows(nodeLadderSchema) }),
				latest: z.array(flowRunSchema),
			}),
		),
	}),
);
