import type { DashboardSummary } from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";
import {
	neededYouReasonSchema,
	runStatusSchema,
	runSummarySchema,
} from "../runs";
import {
	flowHealthRowSchema,
	latestReportSchema,
	neededReasonCountSchema,
	spaceWatchSchema,
} from "./flow-health-schemas";
import {
	hourRangeSchema,
	knownCostSchema,
	nightCountsSchema,
	nightRangeSchema,
	spreadSchema,
	statusCountSchema,
	topRows,
} from "./measure-schemas";

/**
 * The dashboard of a Space or a project: its cards, its runs, and its
 * numbers per range of days. The output mirrors the engine's type exactly
 * (`exact`).
 */

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
	tokens: z.object({ input: z.number(), output: z.number() }).nullable(),
	group: z.string(),
	/** A test run: the nodes its start pinned and skipped. Older Hosts send none. */
	test: z
		.object({ pinned: z.array(z.string()), skipped: z.array(z.string()) })
		.optional(),
});

const gateStateSchema = z.enum(["answered", "unanswered", "waiting"]);

const nightTotalsSchema = z.object({
	night: z.number(),
	runs: z.number(),
	ended: z.number(),
	finished: z.number(),
	costUsd: z.number(),
	tokens: z.number(),
	gates: z.number(),
	/** The runs that needed you. Older Hosts send none. */
	neededYou: z.number().optional(),
});

const periodTotalsSchema = nightTotalsSchema.omit({ night: true }).extend({
	perNight: z.array(nightTotalsSchema),
});

const nightsRangeSchema = z.object({
	nights: nightRangeSchema,
	spend: z.object({
		total: z.number(),
		tokens: z.number(),
		runs: z.number(),
		nightsWithRuns: z.number(),
		unknown: z.number(),
		groups: z.array(
			z.object({
				key: z.string(),
				label: z.string(),
				runs: z.number(),
				total: z.number(),
				unfinished: z.number(),
				tokens: z.number(),
				unfinishedTokens: z.number(),
			}),
		),
		perNight: z.array(nightCountsSchema),
		tokensPerNight: z.array(nightCountsSchema),
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
		failed: topRows(
			dashboardRunSchema.extend({
				after: z.object({
					runs: z.number(),
					finished: z.number(),
					last: z
						.object({ status: runStatusSchema, createdAt: z.number() })
						.nullable(),
				}),
			}),
		),
		failing: topRows(
			z.object({
				key: z.string(),
				group: z.string(),
				title: z.string(),
				runId: z.string(),
				lastAt: z.number(),
				reason: z.string().nullable(),
				failed: z.number(),
				fixedAt: z.number().nullable(),
			}),
		),
		stillFailing: z.number(),
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
				waiting: z.number(),
				runs: z.number(),
				lastAskedAt: z.number(),
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
	/** How often the runs needed you, and why. Older Hosts send none. */
	needed: z
		.object({
			runs: z.number(),
			needed: z.number(),
			reasons: z.array(neededReasonCountSchema),
			perNight: z.array(nightCountsSchema),
			groups: topRows(
				z.object({
					label: z.string(),
					runs: z.number(),
					needed: z.number(),
					reasons: z.array(neededReasonCountSchema),
				}),
			),
			latest: z.array(
				z.object({
					runId: z.string(),
					runTitle: z.string(),
					group: z.string(),
					createdAt: z.number(),
					reasons: z.array(neededYouReasonSchema),
				}),
			),
		})
		.optional(),
	/** The newest report of each flow, the newest end first. Older Hosts send none. */
	reports: topRows(
		latestReportSchema.extend({
			key: z.string(),
			group: z.string(),
			title: z.string(),
		}),
	).optional(),
	totals: periodTotalsSchema,
	before: periodTotalsSchema,
	flows: topRows(flowHealthRowSchema).nullable(),
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
				tokens: z.number(),
				latestAt: z.number().nullable(),
			}),
			dayBefore: z.object({
				runs: z.number(),
				finished: z.number(),
				failed: z.number(),
				cost: knownCostSchema,
				tokens: z.number(),
			}),
			yesterday: z.object({ running: z.number(), gates: z.number() }),
			allTime: knownCostSchema,
			hours: z.array(
				z.object({
					hour: z.number(),
					active: z.number(),
					gates: z.number(),
					costUsd: z.number(),
					tokens: z.number(),
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
		healthNights: nightRangeSchema,
		lastNight: z
			.object({
				night: z.number(),
				runs: z.number(),
				cost: knownCostSchema,
				tokens: z.number(),
				// The test runs among `runs`. Older Hosts send none.
				tests: z.number().optional(),
				latest: z.array(runSummarySchema.extend({ group: z.string() })),
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
		/** Older Hosts send none. */
		watch: spaceWatchSchema.optional(),
	}),
);
