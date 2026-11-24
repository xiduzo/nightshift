import { agentProfileSchema, modelProfileSchema } from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { profileListSchema, profileViewSchema } from "./schemas";

/** The profile an edit changes; a new profile has none. */
const edited = { id: z.string().min(1).optional() };

/**
 * Profiles: an Agent Profile (a harness, a model and its tools) for Agent
 * nodes, or a Model Profile (a decider and its model) for Decisions and
 * Values decided by a model. Each has an id that never changes, which
 * flows use with this computer's id, and a name a rename changes.
 */
export const profiles = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the profiles of this computer, with the nodes that use each.",
		})
		.output(output(profileListSchema))
		.handler(({ context }) =>
			context.configUse.profiles({
				spaceId: context.spaceId,
				actor: context.actor,
			}),
		),
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
			const saved = await context.deviceConfig.saveProfile(
				context.actor,
				id !== undefined ? { profile, id } : { profile },
			);
			// The Spaces it is offered to show its new name.
			if (id !== undefined) {
				await context.offers.renamed(saved.id, context.session.user.id);
			}
			return saved;
		}),
	/** Flows that name it refuse to start until they name another profile. */
	remove: ownerProcedure
		.route({
			summary:
				"Removes a profile. Flows that name it do not start until they name another.",
		})
		.output(output(z.void()))
		.input(z.object({ id: z.string() }))
		.handler(({ context, input }) =>
			context.deviceConfig.removeProfile(context.actor, { id: input.id }),
		),
};
