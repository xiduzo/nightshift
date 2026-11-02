import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";

const catalogEvent = z.object({
	name: z.string(),
	attributes: z.array(z.string()),
});

/** Anonymous usage on this computer: what waits, the catalog, and a new id. */
export const usage = {
	outbox: ownerProcedure
		.route({
			summary:
				"Lists the anonymous usage that waits on this computer, and the last batch that left.",
		})
		.output(
			output(
				z.object({
					waiting: z.array(z.unknown()),
					lastSent: z.array(z.unknown()),
				}),
			),
		)
		.handler(({ context }) => context.usage.outbox()),
	catalog: ownerProcedure
		.route({
			summary: "Lists the usage events and the fields each one can send.",
		})
		.output(output(z.object({ events: z.array(catalogEvent) })))
		.handler(({ context }) => context.usage.catalog()),
	resetId: ownerProcedure
		.route({
			summary:
				"Makes a new anonymous id for this computer, and the old one stops matching.",
		})
		.output(output(z.object({ ok: z.literal(true) })))
		.handler(({ context }) => context.usage.resetId()),
};
