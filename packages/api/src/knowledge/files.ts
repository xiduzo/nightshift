import { z } from "zod";

import { output } from "../output";
import { projectProcedure } from "../projects";
import { agentSchema, projectInput } from "./access";
import {
	knowledgeFileSchema,
	knowledgeTextSchema,
	knowledgeUseSchema,
} from "./schemas";

/** The most of one file `knowledge.read` returns. */
const READ_MAX_BYTES = 1024 * 1024;

/**
 * The files of a project's knowledge: the list, one file, and how often
 * agents use each.
 */
export const knowledgeFiles = {
	/**
	 * The files of the project's knowledge, as its Space lists them, and
	 * nothing about the flows that fill it: what an agent in a terminal
	 * lists as its MCP resources.
	 */
	files: projectProcedure(projectInput)
		.route({
			summary: "Lists the files of a project's knowledge in its Space.",
		})
		.output(output(z.array(knowledgeFileSchema)))
		.handler(
			async ({ context, input }) =>
				(await context.knowledge.listing(input.projectId)).files,
		),
	/**
	 * One file of a project's knowledge, by its path: this computer's copy,
	 * else its content by hash from the Space (its Host). Null: no such file.
	 */
	read: projectProcedure(
		projectInput.extend({
			path: z.string().min(1).max(1000),
			maxBytes: z.number().int().min(1).max(READ_MAX_BYTES).optional(),
			/** Start at a search hit's section, page or line. */
			from: z
				.object({
					section: z.string().trim().min(1).max(500).optional(),
					line: z.number().int().min(1).optional(),
					page: z.number().int().min(1).optional(),
				})
				.optional(),
			agent: agentSchema,
		}),
	)
		.route({
			summary:
				"Reads one file of a project's knowledge, by its path in the knowledge.",
		})
		.output(output(knowledgeTextSchema.nullable()))
		.handler(({ context, input }) =>
			context.knowledge.read(input.projectId, input.path, {
				maxBytes: input.maxBytes ?? READ_MAX_BYTES,
				...(input.from ? { from: input.from } : {}),
				...(input.agent ? { agent: true } : {}),
			}),
		),
	/**
	 * How often agents found and read each file of the project's knowledge
	 * in the last 90 days, when a run last used it, and which files no run
	 * used in 30 days.
	 */
	use: projectProcedure(projectInput)
		.route({
			summary:
				"Says how often agents found and read each file of a project's knowledge, when a run last used it, and which files no run used lately.",
		})
		.output(output(knowledgeUseSchema))
		.handler(({ context, input }) => context.knowledge.use(input.projectId)),
};
