import {
	type FlowNotice,
	type FlowRevisionItem,
	type FlowRevisionView,
	type KeptValue,
	revisionKinds,
} from "@nightshift/engine";
import {
	type FlowDiff,
	type FlowDiffSummary,
	type FlowIssue,
	type FlowListItem,
	type FlowNode,
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

const shape = flowSchema.shape;
const nodeSchema = shape.nodes.element;
const edgeSchema = shape.edges.element;

/** What was added, removed and changed in one list of a flow. */
function listDiffSchema<T extends z.ZodType>(item: T) {
	return z.object({
		added: z.array(item),
		removed: z.array(item),
		changed: z.array(
			z.object({ before: item, after: item, fields: z.array(z.string()) }),
		),
	});
}

/** Typed as the node's own position: each node type has its own copy of the shape. */
const positionSchema: z.ZodType<FlowNode["position"]> = z.object({
	x: z.number(),
	y: z.number(),
});

/** What changes between two flows: nodes and Sections by id, inputs, outputs and variables by name. */
export const flowDiffSchema = exact<FlowDiff>()(
	z.object({
		nodes: z.object({
			added: z.array(nodeSchema),
			removed: z.array(nodeSchema),
			changed: z.array(
				z.object({
					id: z.string(),
					before: nodeSchema,
					after: nodeSchema,
					fields: z.array(z.string()),
					moved: z.boolean(),
				}),
			),
			moved: z.array(
				z.object({
					id: z.string(),
					before: positionSchema,
					after: positionSchema,
				}),
			),
		}),
		edges: listDiffSchema(edgeSchema),
		inputs: listDiffSchema(shape.inputs.unwrap().element),
		outputs: listDiffSchema(shape.outputs.unwrap().element),
		variables: listDiffSchema(shape.variables.unwrap().element),
		sections: listDiffSchema(shape.sections.unwrap().element),
		flow: z.array(z.string()),
	}),
);

/** The counts of a diff. */
const flowDiffSummarySchema = exact<FlowDiffSummary>()(
	z.object({
		added: z.number(),
		removed: z.number(),
		changed: z.number(),
		moved: z.number(),
		edges: z.number(),
		other: z.number(),
		empty: z.boolean(),
	}),
);

const revisionNameSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
});

/** One revision of a flow: who saved it, when, on which Device, and what it changed. */
export const flowRevisionItemSchema = exact<FlowRevisionItem>()(
	z.object({
		id: z.string(),
		at: z.number(),
		kind: z.enum(revisionKinds),
		person: revisionNameSchema.nullable(),
		device: revisionNameSchema,
		current: z.boolean(),
		changes: flowDiffSummarySchema.nullable(),
	}),
);

/** One revision with its flow, and the diff to it from another flow. */
export const flowRevisionViewSchema = exact<FlowRevisionView>()(
	z.object({
		revision: flowRevisionItemSchema.extend({ flow: flowSchema.nullable() }),
		against: z.object({
			revisionId: z.string().nullable(),
			flow: flowSchema.nullable(),
		}),
		diff: flowDiffSchema.nullable(),
	}),
);
