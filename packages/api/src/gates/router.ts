import { z } from "zod";

import { output } from "../output";
import { permitted, protectedProcedure } from "../procedures";
import { openGateSchema } from "./schemas";

/** The Needs-you inbox. */
export const gates = {
	list: protectedProcedure
		.route({
			summary:
				"Lists the open Gates of the Space's runs, oldest first: the Needs-you inbox.",
		})
		.output(output(z.array(openGateSchema)))
		.handler(({ context }) => context.space.listGates()),
	resolve: permitted({ gate: ["resolve"] })
		.route({
			summary:
				"Answers an open Gate with one of its choices, and the run goes on.",
		})
		.output(output(z.void()))
		.input(
			z.object({
				runId: z.string(),
				stepId: z.string(),
				choice: z.string().min(1),
				note: z.string().optional(),
			}),
		)
		.handler(({ context, input }) => context.space.resolveGate(input)),
};
