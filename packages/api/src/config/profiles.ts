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
		.handler(async ({ context, input }) => {
			const { previousName, ...profile } = input;
			const renamed =
				previousName !== undefined && previousName !== profile.name;
			if (
				(previousName === undefined || renamed) &&
				context.profiles.get(profile.name)
			) {
				throw new Error(
					`A profile named "${profile.name}" already exists. Pick another name.`,
				);
			}
			if (renamed) {
				const use = (await context.space.flowUse()).profiles.get(previousName);
				if (use && use.length > 0) {
					throw new Error(
						`The flows ${use.map((u) => u.flowName).join(", ")} use "${previousName}". Change it there first, or keep the name.`,
					);
				}
			}
			const unknown = profile.connections.filter(
				(name) => !context.connections.get(name),
			);
			if (unknown.length > 0) {
				throw new Error(
					`There is no connection named ${unknown.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`,
				);
			}
			const unknownClis = profile.clis.filter(
				(name) => !context.cliTools.get(name),
			);
			if (unknownClis.length > 0) {
				throw new Error(
					`There is no CLI tool named ${unknownClis.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`,
				);
			}
			const saved = await context.profiles.save(profile);
			if (renamed) await context.profiles.remove(previousName);
			return saved;
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
