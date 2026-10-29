import { cliToolsInUse } from "@nightshift/engine";
import {
	cliToolInputSchema,
	removeCliTool,
} from "@nightshift/engine/device-config";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import {
	cliToolCheckSchema,
	cliToolListSchema,
	cliToolSchema,
	signInResultSchema,
} from "./schemas";

/**
 * CLI tools: programs on this computer that the agents may run. Agent nodes
 * and profiles name them in `clis`. A tool can run another program with a
 * login of its own: several accounts of one program.
 */
export const cliTools = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the CLI tools the agents may run, with the flows and profiles that name each.",
		})
		.output(output(cliToolListSchema))
		.handler(async ({ context }) =>
			cliToolsInUse(context, await context.space.flowUse()),
		),
	/** The programs this computer can run by name, to pick one from. */
	programs: ownerProcedure
		.route({ summary: "Lists the programs this computer can run by name." })
		.output(output(z.array(z.string())))
		.handler(({ context }) => context.checks.programs()),
	/** Where the program is, its version and the help the agents read. Read-only. */
	check: ownerProcedure
		.route({
			summary:
				"Checks a program: where it is, its version and the help the agents read. A CLI tool's name checks the program it runs.",
		})
		.output(output(cliToolCheckSchema))
		.input(z.object({ name: cliToolInputSchema.shape.name }))
		.handler(({ context, input }) =>
			context.checks.cli(context.cliTools.program(input.name)),
		),
	/** Adds a CLI tool, or changes it. */
	save: ownerProcedure
		.route({
			summary:
				"Adds a CLI tool, or changes its program, description, login or git host.",
		})
		.output(output(cliToolSchema))
		.input(cliToolInputSchema)
		.handler(({ context, input }) => context.cliTools.save(input)),
	/** Runs the sign-in command of a tool's login now. */
	signIn: ownerProcedure
		.route({
			summary:
				"Signs a CLI tool's login in: runs its sign-in command in the tool's own folder. The output shows secret values as •••.",
		})
		.output(output(signInResultSchema))
		.input(z.object({ name: cliToolInputSchema.shape.name }))
		.handler(({ context, input }) => context.toolLaunchers.signIn(input.name)),
	/** Also takes it off the profiles that name it, and removes its login's folder. */
	remove: ownerProcedure
		.route({
			summary:
				"Removes a CLI tool and its login's folder, and takes it off the profiles that name it.",
		})
		.output(output(z.void()))
		.input(z.object({ name: z.string() }))
		.handler(async ({ context, input }) => {
			await removeCliTool(context, input.name);
			await context.toolLaunchers.forget(input.name);
		}),
};
