import {
	NEEDED_YOU_REASONS,
	RUN_END_REASONS,
	RUNGS,
	type RunSummary,
} from "@nightshift/engine";
import { outcomeColorSchema } from "@nightshift/flows";
import { z } from "zod";

import { exact } from "../output";

/**
 * A run as a list shows it: its status, the Device that walks it, its
 * Gates, its cost and its metrics. The output mirrors the engine's view
 * type exactly (`exact`).
 */

export const runStatusSchema = z.enum([
	"running",
	"failed",
	"waiting",
	"sleeping",
	"finished",
	"stopped",
	"interrupted",
]);

/**
 * What a run warning is about: a cost that is not known, a guard of the
 * run policy (the budget, a turn limit, no activity, a loop), a run that
 * does not start from the newest commit of its base branch, a score a
 * Command step wrote that Night Shift left out, data that does not
 * match a shape Night Shift inferred from an earlier run, or a report
 * longer than Night Shift keeps.
 */
const runWarningKindSchema = z.enum([
	"cost-unknown",
	"budget",
	"turns",
	"stalled",
	"looping",
	"base-ref",
	"score",
	"device-fallback",
	"shape",
	"report",
]);

/** How the End node that ended a run says it came out. */
export const runResultSchema = z.enum(["done", "nothing-to-do", "failed"]);

/** The Device that walks a run, or one a run or a step runs on. */
export const runWalkerSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	thisDevice: z.boolean(),
});

/** When nobody answered a Gate by `at` (epoch ms), it takes `choose`. */
export const gateDeadlineSchema = z.object({
	at: z.number(),
	choose: z.string(),
});

/** One choice of a Gate. */
export const gateChoiceSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	color: outcomeColorSchema.optional(),
	/** The choice needs a note: the answer an Agent goes on with. */
	needsNote: z.literal(true).optional(),
	/** What happens when a person picks it. Absent: nobody wrote one. */
	impact: z.string().optional(),
});

const runTriggerSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("manual") }),
	z.object({
		kind: z.literal("schedule"),
		scheduleId: z.string(),
		at: z.number(),
	}),
	z.object({
		kind: z.literal("webhook"),
		scheduleId: z.string(),
		at: z.number(),
	}),
]);

export const costFields = {
	costUsd: z.number(),
	costEstimated: z.boolean(),
	costMissing: z.number(),
	costCalls: z.number(),
};

/** Who chose a Gate's option: a person or its deadline. Null: nobody. */
const answeredBySchema = z.enum(["person", "deadline"]).nullable();

/**
 * Why a run needed you: a person answered a Gate or an Ask, resumed,
 * stopped, or took the run over.
 */
export const neededYouReasonSchema = z.enum(NEEDED_YOU_REASONS);

/** The two ladders: the work ladder, and the choice ladder (Decisions). */
export const ladderSchema = z.enum(["work", "choice"]);

/** Who works or decides on a rung: a rule, a model, an agent, a called flow, a person. */
export const rungBySchema = z.enum([
	"rule",
	"model",
	"agent",
	"flow",
	"person",
]);

/**
 * The start of a run's report: the End step that wrote it, at most 600
 * characters of its Markdown, and whether it goes on. The full text is in
 * that step's outputs (`report`). Absent: no report.
 */
export const runReportGlanceSchema = z.object({
	stepId: z.string(),
	excerpt: z.string(),
	more: z.boolean(),
});

/** A time a step slept; `to` is null while it sleeps. */
export const sleepSchema = z.object({
	from: z.number(),
	to: z.number().nullable(),
});

/**
 * How long a run or a step took, its agents' time and tokens, its Gates'
 * wait, how sure its cost is, and the pull request it opened.
 */
export const metricsSchema = z.object({
	wallMs: z.number().nullable(),
	agentMs: z.number(),
	gateWaitMs: z.number(),
	tokens: z.object({
		input: z.number(),
		output: z.number(),
		cacheRead: z.number(),
		cacheWrite: z.number(),
	}),
	/** `billed`: every cost was reported. `estimated`: part is priced from tokens. `unknown`: part is not known. */
	costBasis: z.enum(["billed", "estimated", "unknown"]),
	prUrl: z.string().nullable(),
	/** How often agents searched and read the project's knowledge. Absent: neither. */
	knowledge: z.object({ searches: z.number(), reads: z.number() }).optional(),
	/**
	 * The feedback on a run: each Gate answered, whether a person found it
	 * `useful`, what became of its pull request, and the flow's own scores. Only on a
	 * run. A score's name is an open list: a newer peer's name passes.
	 */
	scores: z
		.array(
			z.object({
				score: z.string(),
				value: z.number(),
				label: z.string().nullable(),
				stepId: z.string().nullable(),
				at: z.number(),
				by: answeredBySchema,
			}),
		)
		.optional(),
	/**
	 * Where the work landed: the run's landings per node, rung and tier,
	 * with what they cost, every try included. `via`: the Subflow nodes it
	 * ran in. A Decision's entry counts how often a decider gave a
	 * probability (`picked`) and was not sure enough (`unsure`).
	 * Only on a run.
	 */
	ladder: z
		.array(
			z.object({
				ladder: ladderSchema,
				nodeId: z.string(),
				via: z.string().optional(),
				rung: z.enum(RUNGS),
				by: rungBySchema,
				tier: z.string().nullable(),
				landed: z.number(),
				costUsd: z.number(),
				costEstimated: z.boolean(),
				costMissing: z.number(),
				picked: z.number().optional(),
				unsure: z.number().optional(),
			}),
		)
		.optional(),
});

export const runSummarySchema = exact<RunSummary>()(
	z.object({
		id: z.string(),
		projectId: z.string(),
		walker: runWalkerSchema,
		device: runWalkerSchema,
		trigger: runTriggerSchema,
		startedBy: z
			.object({ id: z.string(), name: z.string().nullable() })
			.nullable(),
		flowName: z.string().nullable(),
		title: z.string(),
		worktreePath: z.string(),
		branch: z.string(),
		baseRef: z.string(),
		runFolder: z.boolean().optional(),
		status: runStatusSchema,
		reason: z.string().nullable(),
		endReason: z.enum(RUN_END_REASONS).nullable(),
		result: runResultSchema.nullable(),
		wakeAt: z.number().nullable(),
		signal: z.string().nullable(),
		inputs: z.record(z.string(), z.json()),
		stopAt: z.number().nullable(),
		stopAfterStep: z.boolean(),
		createdAt: z.number(),
		lastActivityAt: z.number(),
		endedAt: z.number().nullable(),
		...costFields,
		warnings: z.array(
			z.object({
				kind: runWarningKindSchema,
				message: z.string(),
				stepId: z.string().nullable(),
				nodeId: z.string().nullable(),
				at: z.number(),
			}),
		),
		subflows: z.array(
			z.object({
				flowName: z.string(),
				status: runStatusSchema,
				...costFields,
				startedAt: z.number(),
				endedAt: z.number().nullable(),
			}),
		),
		gates: z.array(
			z.object({
				openedAt: z.number(),
				closedAt: z.number().nullable(),
				answeredBy: answeredBySchema,
			}),
		),
		/** Each time a person stepped in, oldest first. */
		neededYou: z.array(
			z.object({
				reason: neededYouReasonSchema,
				at: z.number(),
				/** The flow draws this Gate or Ask for a person. */
				planned: z.boolean(),
				nodeId: z.string().optional(),
				question: z.string().optional(),
			}),
		),
		report: runReportGlanceSchema.optional(),
		sleeps: z.array(sleepSchema),
		metrics: metricsSchema,
		/** A test run: the nodes its start pinned and skipped. Absent: not a test run. */
		test: z
			.object({ pinned: z.array(z.string()), skipped: z.array(z.string()) })
			.optional(),
	}),
);
