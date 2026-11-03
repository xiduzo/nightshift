import { z } from "zod";

/** The longest value a Personal secret may have, in characters: a key file fits, a database does not. */
export const PERSONAL_SECRET_MAX = 64 * 1024;

/** A Personal secret as a Device lists it: its name and when it was set, never its value. */
export const personalSecretNameSchema = z.object({
	name: z.string(),
	setAt: z.number(),
});
export type PersonalSecretName = z.infer<typeof personalSecretNameSchema>;

/** A Project secret as a Member lists it: its name, when it was set and by whom, never its value. */
export const projectSecretNameSchema = z.object({
	name: z.string(),
	setAt: z.number(),
	/** The Person who set it last, as the Host knows them. Null: not known. */
	setBy: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type ProjectSecretName = z.infer<typeof projectSecretNameSchema>;

/** A Project, by its Space: what every Project secret call names. */
export const projectRefSchema = z.object({
	spaceId: z.string().min(1),
	projectId: z.string().min(1),
});

/** The run of a step that asks for its Project's secrets. */
export const stepRunSchema = projectRefSchema.extend({
	runId: z.string().min(1),
});
