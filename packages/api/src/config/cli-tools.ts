import { cliToolInputSchema, removeCliTool } from "@nightshift/engine";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import {
	cliToolCheckSchema,
	cliToolListSchema,
	cliToolSchema,
} from "./schemas";

/**
 * CLI tools: programs on this computer that the agents may run. Agent nodes
 * and profiles name them in `clis`.
 */
export const cliTools = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the CLI tools the agents may run, with the flows and profiles that name each.",
		})
		.output(output(cliToolListSchema))
		.handler(async ({ context }) => {
			const use = (await context.space.flowUse()).clis;
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
	programs: ownerProcedure
		.route({ summary: "Lists the programs this computer can run by name." })
		.output(output(z.array(z.string())))
		.handler(({ context }) => context.checks.programs()),
	/** Where the program is, its version and the help the agents read. Read-only. */
	check: ownerProcedure
		.route({
			summary:
				"Checks a program: where it is, its version and the help the agents read.",
		})
		.output(output(cliToolCheckSchema))
		.input(z.object({ name: cliToolInputSchema.shape.name }))
		.handler(({ context, input }) => context.checks.cli(input.name)),
	/** Adds a CLI tool, or changes its description. */
	save: ownerProcedure
		.route({ summary: "Adds a CLI tool, or changes its description." })
		.output(output(cliToolSchema))
		.input(cliToolInputSchema)
		.handler(({ context, input }) => context.cliTools.save(input)),
	/** Also takes it off the profiles that name it. */
	remove: ownerProcedure
		.route({
			summary:
				"Removes a CLI tool, and takes it off the profiles that name it.",
		})
		.output(output(z.void()))
		.input(z.object({ name: z.string() }))
		.handler(({ context, input }) => removeCliTool(context, input.name)),
};
