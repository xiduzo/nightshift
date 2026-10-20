import { flowNameSchema, flowSchema } from "@nightshift/flows";
import { z } from "zod";

import { ownerProcedure, protectedProcedure } from "../procedures";

const flowRef = z.object({ projectId: z.string(), name: flowNameSchema });

export const flows = {
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) => context.space.listFlows(input.projectId)),
	get: protectedProcedure
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.getFlow(input.projectId, input.name),
		),
	/** Saves drafts with errors too. Returns the issues. Writes this computer's Clone: its owner's. */
	save: ownerProcedure
		.input(flowRef.extend({ flow: flowSchema }))
		.handler(({ context, input }) =>
			context.space.saveFlow(input.projectId, input.name, input.flow),
		),
	remove: ownerProcedure
		.input(flowRef)
		.handler(({ context, input }) =>
			context.space.deleteFlow(input.projectId, input.name),
		),
};
