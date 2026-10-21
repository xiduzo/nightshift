import {
	type DashboardSummary,
	type FlowHealthDetail,
	isTimeZone,
} from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";
import { runStatusSchema, runSummarySchema } from "../runs";

/**
 * The input and output schemas of the dashboard. The outputs mirror the
 * engine's types exactly (`exact`).
 */

/** The reader's time zone: where a night's noon falls. Default UTC. */
export const timeZoneSchema = z
	.string()
	.refine(isTimeZone, {
		message: "Choose a time zone such as Europe/Amsterdam.",
	})
	.default("UTC");

const nightRangeSchema = z.literal([7, 30, 90]);
const hourRangeSchema = z.literal([24, 48, 168]);

const knownCostSchema = z.object({
	costUsd: z.number(),
	costEstimated: z.boolean(),
	costMissing: z.number(),
});

const spreadSchema = z.object({
	min: z.number(),
	q1: z.number(),
	median: z.number(),
	q3: z.number(),
	max: z.number(),
	count: z.number(),
});

const topRows = <T extends z.ZodType>(row: T) =>
	z.object({ rows: z.array(row), count: z.number() });

const statusCountSchema = z.object({
	status: runStatusSchema,
	count: z.number(),
});

const nightCountsSchema = z.object({
	night: z.number(),
	counts: z.record(z.string(), z.number()),
});

const dashboardRunSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: runStatusSchema,
	createdAt: z.number(),
	reason: z.string().nullable(),
	wakeAt: z.number().nullable(),
	branch: z.string(),
	costUsd: z.number(),
	costEstimated: z.boolean(),
	costMissing: z.number(),
	group: z.string(),
});

const gateStateSchema = z.enum(["answered", "unanswered", "waiting"]);

const nightsRangeSchema = z.object({
	nights: nightRangeSchema,
	spend: z.object({
		total: z.number(),
		runs: z.number(),
		nightsWithRuns: z.number(),
		unknown: z.number(),
		groups: z.array(
			z.object({
				key: z.string(),
				label: z.string(),
				runs: z.number(),
				total: z.number(),
			}),
		),
		perNight: z.array(nightCountsSchema),
		priciest: z.array(dashboardRunSchema),
	}),
	runs: z.object({
		runs: z.number(),
		ended: z.number(),
		finished: z.number(),
		nightsWithRuns: z.number(),
		statuses: z.array(statusCountSchema),
		perNight: z.array(nightCountsSchema),
		groups: topRows(
			z.object({
				label: z.string(),
				runs: z.number(),
				finished: z.number(),
				failed: z.number(),
			}),
		),
		failed: topRows(dashboardRunSchema),
	}),
	gates: z.object({
		asked: z.number(),
		runsAsking: z.number(),
		answered: z.number(),
		unanswered: z.number(),
		answerTime: spreadSchema.nullable(),
		states: z.array(gateStateSchema),
		perNight: z.array(nightCountsSchema),
		groups: topRows(
			z.object({
				label: z.string(),
				asked: z.number(),
				answered: z.number(),
				unanswered: z.number(),
				typical: z.number().nullable(),
				longest: z.number().nullable(),
			}),
		),
		latest: z.array(
			z.object({
				key: z.string(),
				runId: z.string(),
				runTitle: z.string(),
				group: z.string(),
				openedAt: z.number(),
				state: gateStateSchema,
				wait: z.number().nullable(),
			}),
		),
	}),
});

const flowHealthRowSchema = z.object({
	name: z.string(),
	last: z
		.object({
			runId: z.string(),
			status: runStatusSchema,
			startedAt: z.number(),
		})
		.nullable(),
	runs: z.number(),
	finished: z.number(),
	ended: z.number(),
	rate: z.number().nullable(),
	cost: spreadSchema.nullable(),
	unfinished: z.object({ count: z.number(), costUsd: z.number() }),
	unknownCost: z.number(),
	freeRuns: z.number(),
});

/** The dashboard of the Space, of one project, or of every Space. */
export const dashboardSummarySchema = exact<DashboardSummary>()(
	z.object({
		at: z.number(),
		cards: z.object({
			running: z.number(),
			sleeping: z.number(),
			nextWakeAt: z.number().nullable(),
			lastDay: z.object({
				runs: z.number(),
				finished: z.number(),
				failed: z.number(),
				cost: knownCostSchema,
				latestAt: z.number().nullable(),
			}),
			allTime: knownCostSchema,
			hours: z.array(
				z.object({
					hour: z.number(),
					active: z.number(),
					gates: z.number(),
					costUsd: z.number(),
					finished: z.number(),
					failed: z.number(),
					other: z.number(),
				}),
			),
		}),
		recent: z.array(runSummarySchema),
		open: z.object({
			rows: z.array(dashboardRunSchema),
			count: z.number(),
			running: z.number(),
			nextWakeAt: z.number().nullable(),
		}),
		activity: z.array(
			z.object({
				hours: hourRangeSchema,
				perHour: z.array(z.object({ hour: z.number(), active: z.number() })),
				peak: z.number(),
				busy: z.number(),
				started: z.number(),
				groups: topRows(
					z.object({
						label: z.string(),
						runs: z.number(),
						started: z.number(),
						atWork: z.number(),
						longest: z.number(),
					}),
				),
			}),
		),
		nights: z.array(nightsRangeSchema),
		lastNight: z
			.object({
				night: z.number(),
				runs: z.number(),
				cost: knownCostSchema,
				latest: z.array(dashboardRunSchema),
			})
			.nullable(),
		upNext: z.array(
			z.object({
				kind: z.enum(["wake", "stop"]),
				at: z.number(),
				runId: z.string(),
				title: z.string(),
			}),
		),
		flowHealth: topRows(flowHealthRowSchema).nullable(),
	}),
);

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
	warnings: z.number(),
});

/** One flow of a project in detail, per night range. */
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
				length: spreadSchema.nullable(),
				spent: knownCostSchema,
				spentUnfinished: knownCostSchema,
				dearest: z
					.object({ costUsd: z.number(), startedAt: z.number() })
					.nullable(),
				warnings: z.number(),
				statuses: z.array(statusCountSchema),
				perNight: z.array(nightCountsSchema),
				endedRuns: z.array(
					z.object({
						runId: z.string(),
						startedAt: z.number(),
						night: z.number(),
						costUsd: z.number(),
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
				latest: z.array(flowRunSchema),
			}),
		),
	}),
);
