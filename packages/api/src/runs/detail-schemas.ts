import { COMMAND_KINDS, type RunDetail } from "@nightshift/engine";
import { flowSchema } from "@nightshift/flows";
import { z } from "zod";

import { exact } from "../output";
import { scopeSchema, stepSummarySchema } from "./step-schemas";
import { runSummarySchema, runWalkerSchema } from "./summary-schemas";

/**
 * A run in full: its flow, its steps and what happened to it. The output
 * mirrors the engine's view type exactly (`exact`).
 */

export const runDetailSchema = exact<RunDetail>()(
	runSummarySchema.extend({
		flow: flowSchema,
		calledFlows: z.record(z.string(), flowSchema),
		flowRevision: z.string().nullable(),
		steps: z.array(stepSummarySchema),
		traversals: z.record(z.string(), z.number()),
		calledTraversals: z.array(
			z.object({
				scope: scopeSchema,
				traversals: z.record(z.string(), z.number()),
			}),
		),
		takeOverCommand: z.string().nullable(),
		resumes: z.array(
			z.object({
				at: z.number(),
				by: z.enum(["daemon", "person"]),
				nodeId: z.string(),
				reason: z.string().nullable(),
				action: z.enum(["resume", "rerun", "restart"]),
			}),
		),
		commands: z.array(
			z.object({
				id: z.string(),
				kind: z.enum(COMMAND_KINDS),
				createdAt: z.number(),
			}),
		),
		handOffs: z.array(
			z.object({
				at: z.number(),
				stepId: z.string().nullable(),
				from: runWalkerSchema,
				to: runWalkerSchema,
				commit: z.string(),
			}),
		),
		leases: z.array(
			z.object({
				name: z.string(),
				state: z.enum(["held", "waiting"]),
				nodeId: z.string(),
				section: z.string().nullable(),
				since: z.number(),
				holder: z.object({ runId: z.string(), title: z.string() }).nullable(),
			}),
		),
		services: z.array(
			z.object({
				nodeId: z.string(),
				scopeKey: z.string(),
				state: z.enum(["running", "stopped"]),
				section: z.string().nullable(),
				since: z.number(),
				deviceId: z.string(),
				command: z.string(),
			}),
		),
		variables: z.array(
			z.object({
				scope: scopeSchema.nullable(),
				name: z.string(),
				value: z.json(),
				stepId: z.string().nullable(),
				/** A start value an earlier run kept (`keep`), not `initial`. */
				kept: z.literal(true).optional(),
				at: z.number(),
			}),
		),
	}),
);
