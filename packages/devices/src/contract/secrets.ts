import { z } from "zod";

/** The longest value a Personal secret may have, in characters: a key file fits, a database does not. */
export const PERSONAL_SECRET_MAX = 64 * 1024;

/** A Personal secret as a Device lists it: its name and when it was set, never its value. */
export const personalSecretNameSchema = z.object({
	name: z.string(),
	setAt: z.number(),
});
export type PersonalSecretName = z.infer<typeof personalSecretNameSchema>;
