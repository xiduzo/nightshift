import { roleAllows, spacesOf } from "@nightshift/auth";
import { offerCapsSchema } from "@nightshift/engine";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { ownerProcedure } from "../procedures";

/** One Offer: a profile of a Device, in a Space. */
export const offerRef = z.object({
	spaceId: z.string().min(1),
	profile: z.string().min(1).max(64),
});

/**
 * This computer's Offers: one of its profiles made available to a Space,
 * with a permission-mode cap and a session cap. Made and withdrawn by the
 * computer's owner, in a Space where their role allows `offer.make`.
 */
export const offers = {
	/** Its Offers with "Runs for <Space>", and the Spaces it can offer to. */
	list: ownerProcedure.handler(async ({ context }) => {
		const spaces = (await spacesOf(context.db, context.session.user.id))
			.filter((s) => !s.personal && roleAllows(s.role, { offer: ["make"] }))
			.map((s) => ({ id: s.id, name: s.name }));
		return { offers: await context.offers.list(), spaces };
	}),
	make: ownerProcedure
		.input(offerRef.extend(offerCapsSchema.shape))
		.handler(async ({ context, input }) => {
			if (!(await context.can({ offer: ["make"] }, input.spaceId))) {
				throw new ORPCError("FORBIDDEN", {
					message: "Your role in that Space does not allow offering profiles.",
				});
			}
			await context.offers.make(input, context.session.user.id);
		}),
	/** Its running steps under it end as stopped. */
	withdraw: ownerProcedure
		.input(offerRef)
		.handler(({ context, input }) =>
			context.offers.withdraw(input, context.session.user.id),
		),
};
