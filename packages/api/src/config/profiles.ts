import { saveProfile } from "@nightshift/engine";
import { agentProfileSchema } from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { profileListSchema, profileViewSchema } from "./schemas";

/** Agent Profiles: a harness, a model and its tools under one name. Agent nodes name them. */
export const profiles = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the Agent Profiles of this computer, with the Agent nodes that use each.",
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
		.route({ summary: "Adds an Agent Profile, or changes or renames one." })
		.output(output(profileViewSchema))
		.input(
			agentProfileSchema.extend({
				/** The name it had, when the edit renames it. */
				previousName: z.string().optional(),
			}),
		)
		.handler(({ context, input }) => {
			const { previousName, ...profile } = input;
			return saveProfile(context, profile, {
				previousName,
				flowsUsing: async (name) =>
					(await context.space.flowUse()).profiles.get(name) ?? [],
			});
		}),
	/** Flows that name it refuse to start until they name another profile. */
	remove: ownerProcedure
		.route({
			summary:
				"Removes an Agent Profile. Flows that name it do not start until they name another.",
		})
		.output(output(z.void()))
		.input(z.object({ name: z.string() }))
		.handler(({ context, input }) => context.profiles.remove(input.name)),
};
