import { foundPrograms, setUpProgram } from "@nightshift/engine/device-config";
import { harnessNameSchema } from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";

const foundProgramSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("agent"),
		program: z.string(),
		harness: harnessNameSchema,
		label: z.string(),
	}),
	z.object({ kind: z.literal("tool"), program: z.string(), label: z.string() }),
]);

/**
 * The agent CLIs and the kits' tools this computer has that are not set up
 * yet, found where the daemon looks for programs. The Agents page offers
 * each one. On a Host, the Host's own programs.
 */
export const programs = {
	found: ownerProcedure
		.route({
			summary:
				"Lists the agent CLIs and the tools of the kits found on this computer that are not set up yet.",
		})
		.output(output(z.array(foundProgramSchema)))
		.handler(({ context }) => foundPrograms(context)),
	setUp: ownerProcedure
		.route({
			summary:
				"Sets up a found program: a profile on an agent CLI's harness, or a CLI tool.",
		})
		.output(
			output(
				z.discriminatedUnion("kind", [
					z.object({
						kind: z.literal("agent"),
						profileId: z.string(),
						name: z.string(),
					}),
					z.object({ kind: z.literal("tool"), name: z.string() }),
				]),
			),
		)
		.input(z.object({ program: z.string().min(1) }))
		.handler(({ context, input }) => setUpProgram(context, input.program)),
};
