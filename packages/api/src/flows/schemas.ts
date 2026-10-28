import type { FlowNotice, KeptValue } from "@nightshift/engine";
import {
	type FlowIssue,
	type FlowListItem,
	flowSchema,
	type LoadedFlow,
} from "@nightshift/flows";
import { z } from "zod";

import { exact } from "../output";

/** One problem in a flow. A flow with any `error` cannot run. */
export const flowIssueSchema = exact<FlowIssue>()(
	z.object({
		severity: z.enum(["error", "warning"]),
		message: z.string(),
		nodeId: z.string().optional(),
		edgeId: z.string().optional(),
		sectionId: z.string().optional(),
	}),
);

/** A flow file of a project, without its flow. */
export const flowListItemSchema = exact<FlowListItem>()(
	z.object({
		name: z.string(),
		path: z.string(),
		description: z.string().nullable(),
		/** Null when the file is not a valid flow. */
		nodeCount: z.number().nullable(),
		errorCount: z.number(),
		/** What a run of it asks for. Empty when the file is not a valid flow. */
		inputs: flowSchema.shape.inputs,
		/** The flows whose Subflow nodes run this one. */
		callers: z.array(z.string()),
	}),
);

/** A flow file of a project: its flow (null when not valid) and its problems. */
export const loadedFlowSchema = exact<LoadedFlow>()(
	z.object({
		name: z.string(),
		path: z.string(),
		flow: flowSchema.nullable(),
		issues: z.array(flowIssueSchema),
	}),
);

/** The value a kept variable has between runs on this computer. */
export const keptValueSchema = exact<KeptValue>()(
	z.object({
		name: z.string(),
		value: z.json(),
		runId: z.string(),
		updatedAt: z.number(),
	}),
);

/** What a person must know about a project's flows: what the import on upgrade did. */
export const flowNoticeSchema = exact<FlowNotice>()(
	z.object({
		id: z.string(),
		at: z.number(),
		deviceId: z.string(),
		kind: z.string(),
		message: z.string(),
	}),
);
