import { saveProfile } from "@nightshift/engine";
import { agentProfileSchema, modelProfileSchema } from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure, protectedProcedure } from "../procedures";
import {
	profileListSchema,
	profileViewSchema,
	projectProfilesSchema,
} from "./schemas";

/** The profile an edit changes; a new profile has none. */
const edited = { id: z.string().min(1).optional() };

/**
 * Profiles: an Agent Profile (a harness, a model and its tools) for Agent
 * nodes, or a Model Profile (a decider and its model) for Decisions and
 * Values decided by a model. Each has an id that never changes, and a name
 * that flows use.
 */
export const profiles = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the profiles of this computer, with the nodes that use each.",
		})
		.output(output(profileListSchema))
		.handler(async ({ context }) => {
			const use = await context.space.flowUse();
			return context.profiles.list().map((p) => ({
				...p,
				usedBy: use.profiles.get(p.name) ?? [],
			}));
		}),
	save: ownerProcedure
		.route({ summary: "Adds a profile, or changes or renames one." })
		.output(output(profileViewSchema))
		.input(
			z.union([
				agentProfileSchema.extend(edited),
				modelProfileSchema.extend(edited),
			]),
		)
		.handler(async ({ context, input }) => {
			const { id, ...profile } = input;
			const saved = await saveProfile(context, profile, {
				...(id !== undefined ? { id } : {}),
				flowsUsing: async (name) =>
					(await context.space.flowUse()).profiles.get(name) ?? [],
			});
			// The Spaces it is offered to show its new name.
			if (id !== undefined) {
				await context.offers.renamed(saved.id, context.session.user.id);
			}
			return saved;
		}),
	/**
	 * A project's own profiles, from `.nightshift/profiles.json` in its
	 * Clone here: each says whether this computer's profile of the same
	 * name wins over it.
	 */
	project: protectedProcedure
		.route({
			summary:
				"Lists the profiles of a project's own file, and whether this computer overrides each.",
		})
		.output(output(projectProfilesSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(async ({ context, input }) => {
			const read = await context.space.listProjectProfiles(input.projectId);
			return {
				profiles: read.profiles.map((p) => ({
					...p,
					overridden: context.profiles.byName(p.name) !== null,
				})),
				issues: read.issues,
			};
		}),
	/** Flows that name it refuse to start until they name another profile. */
	remove: ownerProcedure
		.route({
			summary:
				"Removes a profile. Flows that name it do not start until they name another.",
		})
		.output(output(z.void()))
		.input(z.object({ id: z.string() }))
		.handler(({ context, input }) => context.profiles.remove(input.id)),
};
