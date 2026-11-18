import type { StepDetail } from "@nightshift/engine";
import { askFormSchema } from "@nightshift/flows";
import { z } from "zod";

import { exact } from "../output";
import {
	costFields,
	gateChoiceSchema,
	gateDeadlineSchema,
	metricsSchema,
	runWalkerSchema,
	sleepSchema,
} from "./summary-schemas";

/**
 * A step of a run: one visit of one node, with its items, its sessions
 * and its Gate. The detail mirrors the engine's view type exactly (`exact`).
 */

export const scopeSchema = z.object({
	parentStepId: z.string(),
	itemId: z.string().nullable(),
});

export const itemSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	url: z.string().nullable(),
	/** Only in the step's detail (`runs.step`). Older Hosts send it in every summary. */
	value: z.json().optional(),
	state: z.enum(["done", "running", "failed", "blocked", "halted"]),
	branch: z.string().nullable(),
	baseBranch: z.string().nullable(),
	startedAt: z.number(),
	endedAt: z.number().nullable(),
	reason: z.string().nullable(),
});

const sessionSummarySchema = z.object({
	id: z.string(),
	harnessSessionId: z.string().nullable(),
	/** Only in the step's detail (`runs.step`). Older Hosts send it in every summary. */
	prompt: z.string().optional(),
	createdAt: z.number(),
	outcome: z.enum(["failed", "finished", "stopped", "interrupted"]).nullable(),
	error: z.string().nullable(),
	costUsd: z.number().nullable(),
	costEstimated: z.boolean(),
});

/** One visit of one node. */
export const stepSummarySchema = z.object({
	id: z.string(),
	nodeId: z.string(),
	nodeType: z.enum([
		"value",
		"agent",
		"command",
		"decision",
		"call",
		"wait",
		"tool",
		"end",
		"join",
		"lease",
		"service",
		"since-last-run",
		"convert",
		"web-request",
	]),
	visit: z.number(),
	startedAt: z.number(),
	endedAt: z.number().nullable(),
	outcome: z.string().nullable(),
	outputs: z.record(z.string(), z.json()),
	error: z.string().nullable(),
	scope: scopeSchema.nullable(),
	items: z.array(itemSummarySchema),
	sessions: z.array(sessionSummarySchema),
	...costFields,
	device: runWalkerSchema.nullable(),
	gate: z
		.object({
			question: z.string(),
			choices: z.array(gateChoiceSchema),
			openedAt: z.number(),
			deadline: gateDeadlineSchema.nullable(),
			/** An Ask: the form the answer fills in. Absent on every other Gate. */
			form: askFormSchema.optional(),
		})
		.nullable(),
	sleeps: z.array(sleepSchema).optional(),
	metrics: metricsSchema.optional(),
	/** The knowledge files its agents used: read, or at the top of a search. Older Hosts send none. */
	sources: z
		.array(
			z.object({
				path: z.string(),
				section: z.string().nullable(),
				page: z.number().nullable(),
				line: z.number(),
				read: z.boolean(),
			}),
		)
		.optional(),
	/** A step of a test run that stood in for its node. Older Hosts send none. */
	test: z.enum(["pinned", "skipped"]).optional(),
	/** A pinned step: the step of an earlier run its output comes from. */
	pinnedFrom: z
		.object({ runId: z.string(), stepId: z.string(), endedAt: z.number() })
		.optional(),
});

/** One step with the prompt of each session and the element of each item. */
export const stepDetailSchema = exact<StepDetail>()(
	stepSummarySchema.extend({
		items: z.array(itemSummarySchema.extend({ value: z.json() })),
		sessions: z.array(sessionSummarySchema.extend({ prompt: z.string() })),
	}),
);
