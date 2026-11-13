import type { SentAnswerCost, ServedAnswerCost } from "@nightshift/engine";
import { z } from "zod";
import { exact } from "./described";

/**
 * What the answers of Night Shift's own agents cost, on the wire: the rows
 * a Device gives the Host that keeps their Space, and the rows that Host
 * serves of the Space. They are the engine's types (`SentAnswerCost`,
 * `ServedAnswerCost`) as zod checks them. A row is one answer by its
 * `key`, so a row that comes again changes nothing.
 */

/** The most rows in one call, each way. */
export const ANSWER_COSTS_MAX = 500;

const sent = {
	key: z.string().regex(/^[\w-]{8,64}$/),
	spaceId: z.string().min(1),
	projectId: z.string().min(1).max(128).nullable(),
	/** As its Replica wrote it: a newer version may know more agents. */
	agent: z.string().min(1).max(64),
	entry: z.string().min(1).max(64).nullable(),
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	costUsd: z.number().nonnegative().nullable(),
	at: z.number(),
};

const sentSchema = exact<SentAnswerCost>()(z.object(sent));

const servedSchema = exact<ServedAnswerCost>()(
	z.object({
		...sent,
		seq: z.number().int().positive(),
		deviceId: z.string().min(1),
		personId: z.string().min(1),
	}),
);

/** A Device's own rows the Host lacks, and its cursor with the Host per Space. */
export const answerCostsInputSchema = z.object({
	rows: z.array(sentSchema).max(ANSWER_COSTS_MAX).default([]),
	cursors: z.record(z.string(), z.number().int().nonnegative()).default({}),
});

/** The Host's answer. */
export type AnswerCostsBatch = {
	/** The keys of the given rows the Host has now. */
	taken: string[];
	/** The rows of the Device's Spaces after its cursors, its own too. */
	rows: ServedAnswerCost[];
	/** More rows wait after these. */
	more: boolean;
};

export const answerCostsBatchSchema = exact<AnswerCostsBatch>()(
	z.object({
		taken: z.array(z.string()),
		rows: z.array(servedSchema),
		more: z.boolean(),
	}),
);
