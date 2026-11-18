import {
	CHANGE_TRENDS,
	CHANGE_VERDICTS,
	type FlowChanges,
	MOVE_GUARDS,
	MOVE_SETUP_CAUSES,
} from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";
import { nightRangeSchema } from "./measure-schemas";

/**
 * The changes of a flow: its runs before and after a change, and the next
 * changes to try. The output mirrors the engine's type exactly (`exact`).
 */

const flowChangeSchema = z.object({
	firstAt: z.number(),
	at: z.number(),
	saves: z.number(),
	added: z.number(),
	removed: z.number(),
	changed: z.number(),
	edges: z.number(),
	settings: z.number(),
});

const changeMeasureSchema = z.object({
	runs: z.number(),
	finished: z.number(),
	unplanned: z.number(),
	waitMs: z.number(),
	workMs: z.number().nullable(),
	costUsd: z.number().nullable(),
	merged: z.number(),
	closed: z.number(),
	useful: z.number(),
	rated: z.number(),
});

const changeTrendSchema = z.enum(CHANGE_TRENDS);

const changeComparisonSchema = z.object({
	before: changeMeasureSchema,
	after: changeMeasureSchema,
	verdict: z.enum(CHANGE_VERDICTS),
	trends: z.object({
		finished: changeTrendSchema,
		unplanned: changeTrendSchema,
		waitMs: changeTrendSchema,
		workMs: changeTrendSchema,
		costUsd: changeTrendSchema,
	}),
});

const moveRun = { runId: z.string() };
const moveAt = { ...moveRun, nodeId: z.string() };

/** One next change to try on a flow (`FlowMove`). */
const flowMoveSchema = z.discriminatedUnion("kind", [
	z.object({
		...moveAt,
		kind: z.literal("edge"),
		outcome: z.string(),
		runs: z.number(),
	}),
	z.object({
		...moveAt,
		kind: z.literal("loopLimit"),
		outcome: z.string(),
		runs: z.number(),
	}),
	z.object({
		...moveRun,
		kind: z.literal("setup"),
		cause: z.enum(MOVE_SETUP_CAUSES),
		runs: z.number(),
	}),
	z.object({
		...moveAt,
		kind: z.literal("unsure"),
		unsure: z.number(),
		picked: z.number(),
		tier: z.string().nullable(),
	}),
	z.object({
		...moveAt,
		kind: z.literal("sameAnswer"),
		choice: z.string(),
		times: z.number(),
		of: z.number(),
		deadline: z.boolean(),
	}),
	z.object({
		...moveAt,
		kind: z.literal("notes"),
		step: z.string().nullable(),
		notes: z.number(),
		lastNote: z.string(),
	}),
	z.object({
		...moveAt,
		kind: z.literal("leftOpen"),
		open: z.number(),
		asked: z.number(),
	}),
	z.object({
		...moveRun,
		kind: z.literal("wait"),
		nodeId: z.string().nullable(),
		share: z.number(),
		waitMs: z.number(),
		workMs: z.number(),
	}),
	z.object({
		...moveAt,
		kind: z.literal("loop"),
		from: z.string(),
		outcome: z.string(),
		times: z.number(),
		rounds: z.number(),
		extraUsd: z.number(),
	}),
	z.object({
		...moveAt,
		kind: z.literal("endsRuns"),
		runs: z.number(),
		of: z.number(),
		agent: z.boolean(),
	}),
	z.object({
		...moveRun,
		kind: z.literal("guard"),
		guard: z.enum(MOVE_GUARDS),
		runs: z.number(),
	}),
	z.object({ ...moveAt, kind: z.literal("stalled"), runs: z.number() }),
	z.object({
		...moveRun,
		kind: z.literal("late"),
		late: z.number(),
		scheduled: z.number(),
		usualMs: z.number(),
	}),
	z.object({
		...moveRun,
		kind: z.literal("rate"),
		rated: z.number(),
		useful: z.number(),
		runs: z.number(),
	}),
	z.object({
		...moveRun,
		kind: z.literal("nothing"),
		nothing: z.number(),
		runs: z.number(),
	}),
]);

/** Before and after for one flow over some days, and the next changes to try. */
export const flowChangesSchema = exact<FlowChanges>()(
	z.object({
		nights: nightRangeSchema,
		window: z.object({ from: z.number(), split: z.number(), to: z.number() }),
		runs: z.array(
			z.object({
				runId: z.string(),
				startedAt: z.number(),
				finished: z.boolean(),
				unplanned: z.number(),
				costUsd: z.number(),
			}),
		),
		changes: z.array(flowChangeSchema),
		pending: flowChangeSchema.nullable(),
		lastChange: changeComparisonSchema
			.extend({ change: flowChangeSchema })
			.nullable(),
		days: changeComparisonSchema,
		moves: z.array(flowMoveSchema),
		read: z.number(),
	}),
);
