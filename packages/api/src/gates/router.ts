import { z } from "zod";

import { permitted, protectedProcedure } from "../procedures";

/** The Needs-you inbox. */
export const gates = {
	list: protectedProcedure.handler(({ context }) => context.space.listGates()),
	resolve: permitted({ gate: ["resolve"] })
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
