import { flowNameSchema, flowSchema } from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure, protectedProcedure } from "../procedures";
import {
	flowIssueSchema,
	flowListItemSchema,
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
	/** Saves drafts with errors too. Returns the issues. Writes this computer's Clone: its owner's. */
	save: ownerProcedure
		.route({
			summary: "Saves a flow file, also with errors, and returns its problems.",
		})
		.output(output(z.array(flowIssueSchema)))
		.input(flowRef.extend({ flow: flowSchema }))
		.handler(({ context, input }) =>
			context.space.saveFlow(input.projectId, input.name, input.flow),
		),
	remove: ownerProcedure
		.route({ summary: "Removes a flow file from the project." })
		.output(output(z.void()))
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.deleteFlow(input.projectId, input.name),
		),
};
