import { offerCapsSchema, offerRefSchema } from "@nightshift/devices";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { offerListSchema } from "./schemas";

/**
 * This computer's Offers: one of its profiles (by its id) made available to a Space,
 * with a permission-mode cap and a session cap. Made and withdrawn by the
 * computer's owner, in a Space where their role allows `offer.make`, or,
 * on a Host, in the Personal of a Person whose home Host it is.
 */
export const offers = {
	/** Its Offers with "Runs for <Space>", and the Spaces it can offer to. */
	list: ownerProcedure
		.route({
			summary:
				"Lists this computer's Offers, with their runs, and the Spaces it can offer to.",
		})
		.output(output(offerListSchema))
		.handler(async ({ context }) => ({
			offers: await context.offers.list(),
			spaces: await context.offers.spaces(),
		})),
	make: ownerProcedure
		.route({
			summary:
				"Offers one of this computer's profiles to a Space, or changes its caps.",
		})
		.output(output(z.void()))
		.input(offerRefSchema.extend(offerCapsSchema.shape))
		// `make` checks the Space: one of `spaces`.
		.handler(({ context, input }) =>
			context.offers.make(input, context.session.user.id),
		),
	/** Its running steps under it end as stopped. */
	withdraw: ownerProcedure
		.route({ summary: "Withdraws an Offer. Its running steps end as stopped." })
		.output(output(z.void()))
		.input(offerRefSchema)
		.handler(({ context, input }) =>
			context.offers.withdraw(input, context.session.user.id),
		),
};
