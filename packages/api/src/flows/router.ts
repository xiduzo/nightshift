import { flowNameSchema, flowSchema, nameSchema } from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure, permitted, protectedProcedure } from "../procedures";
import {
	flowIssueSchema,
	flowListItemSchema,
	flowNoticeSchema,
	flowRevisionItemSchema,
	flowRevisionViewSchema,
	keptValueSchema,
	loadedFlowSchema,
} from "./schemas";

const flowRef = z.object({ projectId: z.string(), name: flowNameSchema });

export const flows = {
	list: protectedProcedure
		.route({
			summary:
				"Lists the flow files of a project, with their node and error counts.",
		})
		.output(output(z.array(flowListItemSchema)))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) => context.space.listFlows(input.projectId)),
	get: protectedProcedure
		.route({ summary: "Reads one flow file of a project, with its problems." })
		.output(output(loadedFlowSchema))
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.getFlow(input.projectId, input.name),
		),
	/**
	 * Every flow file of a project by name, in one read: what the editor
	 * checks Subflow nodes against.
	 */
	map: protectedProcedure
		.route({
			summary:
				"Reads every flow file of a project by name: its flow, or null when it is not valid.",
		})
		.output(output(z.record(z.string(), flowSchema.nullable())))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) => context.space.flowMap(input.projectId)),
	/** Saves drafts with errors too, as a new revision. Returns the issues. */
	save: permitted({ flow: ["save"] })
		.route({
			summary:
				"Saves a flow, also with errors, as a new revision, and returns its problems.",
		})
		.output(output(z.array(flowIssueSchema)))
		.input(flowRef.extend({ flow: flowSchema }))
		.handler(({ context, input }) =>
			context.space.saveFlow(input.projectId, input.name, input.flow),
		),
	/** The values the flow's kept variables carry from one run to the next. */
	kept: protectedProcedure
		.route({
			summary:
				"Lists the values a flow's kept variables carry from one run to the next on this computer.",
		})
		.output(output(z.array(keptValueSchema)))
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.listKeptValues(input.projectId, input.name),
		),
	resetKept: ownerProcedure
		.route({
			summary:
				"Forgets the kept value of one variable of a flow: its next run starts from the initial value.",
		})
		.output(output(z.void()))
		.input(flowRef.extend({ variable: nameSchema }))
		.handler(({ context, input }) =>
			context.space.resetKeptValue(input.projectId, input.name, input.variable),
		),
	/** What the import on upgrade did that a person must know, oldest first. */
	notices: protectedProcedure
		.route({
			summary:
				"Lists the notices of a project's flows: what the import of its flow folder did.",
		})
		.output(output(z.array(flowNoticeSchema)))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listFlowNotices(input.projectId),
		),
	dismissNotice: ownerProcedure
		.route({ summary: "Removes a notice of a project's flows." })
		.output(output(z.void()))
		.input(z.object({ projectId: z.string(), id: z.string() }))
		.handler(({ context, input }) =>
			context.space.dismissFlowNotice(input.projectId, input.id),
		),
	remove: permitted({ flow: ["remove"] })
		.route({
			summary: "Removes a flow from the project. Its revisions stay.",
		})
		.output(output(z.void()))
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.deleteFlow(input.projectId, input.name),
		),
	revisions: protectedProcedure
		.route({
			summary:
				"Lists the revisions of a flow, newest first: who saved each, when, on which device, and what it changed.",
		})
		.output(output(z.array(flowRevisionItemSchema)))
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.listFlowRevisions(input.projectId, input.name),
		),
	revision: protectedProcedure
		.route({
			summary:
				"Reads one revision of a flow and what changes from another revision, or from the flow as it is now, to it.",
		})
		.output(output(flowRevisionViewSchema))
		.input(
			flowRef.extend({
				revisionId: z.string(),
				/** The revision to compare with. Left out: the flow as it is now. */
				against: z.string().optional(),
			}),
		)
		.handler(({ context, input }) =>
			context.space.getFlowRevision(
				input.projectId,
				input.name,
				input.revisionId,
				input.against,
			),
		),
	restore: permitted({ flow: ["save"] })
		.route({
			summary:
				"Saves a revision of a flow as the flow now, as a new revision, and returns its problems.",
		})
		.output(output(z.array(flowIssueSchema)))
		.input(flowRef.extend({ revisionId: z.string() }))
		.handler(({ context, input }) =>
			context.space.restoreFlowRevision(
				input.projectId,
				input.name,
				input.revisionId,
			),
		),
};
