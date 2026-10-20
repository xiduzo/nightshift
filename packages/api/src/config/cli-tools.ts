import { cliToolInputSchema } from "@nightshift/engine";
import { z } from "zod";

import { ownerProcedure } from "../procedures";
import { flowUse } from "./flow-use";

/**
 * CLI tools: programs on this computer that the agents may run. Agent nodes
 * and profiles name them in `clis`.
 */
export const cliTools = {
	list: ownerProcedure.handler(async ({ context }) => {
		const use = (await flowUse(context.space)).clis;
		return context.cliTools.list().map((tool) => ({
			...tool,
			usedBy: use.get(tool.name) ?? [],
			profiles: context.profiles
				.list()
				.filter((p) => p.clis.includes(tool.name))
				.map((p) => p.name),
		}));
	}),
	/** The programs this computer can run by name, to pick one from. */
	programs: ownerProcedure.handler(({ context }) => context.checks.programs()),
	/** Where the program is, its version and the help the agents read. Read-only. */
	check: ownerProcedure
		.input(z.object({ name: cliToolInputSchema.shape.name }))
		.handler(({ context, input }) => context.checks.cli(input.name)),
	/** Adds a CLI tool, or changes its description. */
	save: ownerProcedure
		.input(cliToolInputSchema)
		.handler(({ context, input }) => context.cliTools.save(input)),
	/** Also takes it off the profiles that name it. */
	remove: ownerProcedure
		.input(z.object({ name: z.string() }))
		.handler(async ({ context, input }) => {
			await context.cliTools.remove(input.name);
			for (const p of context.profiles.list()) {
				if (!p.clis.includes(input.name)) continue;
				const { updatedAt: _at, ...profile } = p;
				await context.profiles.save({
					...profile,
					clis: p.clis.filter((c) => c !== input.name),
				});
			}
		}),
};
