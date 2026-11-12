import {
	type DashboardSummary,
	type FlowHealthDetail,
	isTimeZone,
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
	runSummarySchema,
} from "../runs";

/**
 * The input and output schemas of the dashboard. The outputs mirror the
 * engine's types exactly (`exact`).
 */

/** The reader's time zone: where a day's midnight falls. Default UTC. */
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
	tokens: z.object({ input: z.number(), output: z.number() }).nullable(),
	group: z.string(),
	/** A test run: the nodes its start pinned and skipped. Older Hosts send none. */
	test: z
		.object({ pinned: z.array(z.string()), skipped: z.array(z.string()) })
		.optional(),
});

const gateStateSchema = z.enum(["answered", "unanswered", "waiting"]);

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
const neededReasonCountSchema = z.object({
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
const latestReportSchema = runReportGlanceSchema.extend({
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
const spaceWatchSchema = z.object({
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

const flowHealthRowSchema = z.object({
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
	scores: z.array(flowScoreRowSchema).optional(),
	useful: flowUsefulSchema.optional(),
	neededYou: flowNeededYouSchema.optional(),
	/** The newest report of its own runs. Absent: none, or an older Host. */
	report: latestReportSchema.optional(),
	/** Where the work of its own runs landed. Older Hosts send none. */
	ladders: flowLaddersSchema.optional(),
	/** Older Hosts send none. */
	watch: flowWatchSchema.optional(),
});

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
				// Test runs: only the spend counts them. Older Hosts send none.
				tests: z.number().optional(),
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
				/** Older Hosts send only `night` and `counts`. */
				perNight: z.array(
					nightCountsSchema.extend({
						spent: knownCostSchema.optional(),
						needed: z
							.object({ runs: z.number(), needed: z.number() })
							.optional(),
						/** Per metric name: the sum its runs wrote that day, and how many runs wrote it. */
						metrics: z
							.record(
								z.string(),
								z.object({ sum: z.number(), runs: z.number() }),
							)
							.optional(),
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
				scores: z.array(flowScoreRowSchema).optional(),
				useful: flowUsefulSchema.optional(),
				neededYou: flowNeededYouSchema.optional(),
				/** Where the work of its own runs landed. Older Hosts send none. */
				ladders: flowLaddersSchema
					.extend({ nodes: topRows(nodeLadderSchema) })
					.optional(),
				latest: z.array(flowRunSchema),
			}),
		),
	}),
);
