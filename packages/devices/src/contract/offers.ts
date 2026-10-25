import { permissionModeSchema } from "@nightshift/flows";
import { z } from "zod";

/** The most sessions one Offer may run at once. */
const MAX_SESSION_CAP = 16;

export const offerCapsSchema = z.object({
	permissionCap: permissionModeSchema,
	sessionCap: z.number().int().min(1).max(MAX_SESSION_CAP),
});
export type OfferCaps = z.infer<typeof offerCapsSchema>;

/** One Offer: a profile of a Device, in a Space. */
export const offerRefSchema = z.object({
	spaceId: z.string().min(1),
	profile: z.string().min(1).max(64),
});
