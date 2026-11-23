import { z } from "zod";

import { output } from "../output";
import { projectProcedure } from "../projects";
import { agentSchema, knowledgeProcedure, projectInput } from "./access";
import { knowledgeHitSchema, knowledgeMeaningSchema } from "./schemas";

/**
 * The search of a project's knowledge: by keyword, and by meaning when
 * it is on.
 */
export const knowledgeSearch = {
	/**
	 * The files of a project's knowledge on this computer that best match
	 * the words, best first, each at its best section with an excerpt. By
	 * keyword (BM25): every word must match, else some of them. "a phrase"
	 * in quotes keeps its words together, and a word ending in `*` matches
	 * as a prefix. By meaning too, when Ollama on this computer has the
	 * embedding model: both lists are fused by reciprocal rank.
	 */
	search: projectProcedure(
		projectInput.extend({
			query: z.string().max(1000),
			limit: z.number().int().min(1).max(50).optional(),
			agent: agentSchema,
		}),
	)
		.route({
			summary:
				"Searches the files of a project's knowledge on this computer by keyword, and by meaning when it can, best match first.",
		})
		.output(output(z.array(knowledgeHitSchema)))
		.handler(({ context, input }) =>
			context.knowledge.search(input.projectId, input.query, {
				...(input.limit !== undefined ? { limit: input.limit } : {}),
				...(input.agent ? { agent: true } : {}),
			}),
		),
	/**
	 * Whether search by meaning works for the project on this computer:
	 * off, waiting for Ollama or its model, preparing, or on.
	 */
	meaning: projectProcedure(projectInput)
		.route({
			summary:
				"Says whether knowledge search finds by meaning on this computer, and how far its preparation is.",
		})
		.output(output(knowledgeMeaningSchema))
		.handler(({ context, input }) =>
			context.knowledge.meaning(input.projectId),
		),
	/**
	 * Turns search by meaning on or off for the project, on every computer
	 * of its Space. It changes the knowledge, so it asks a role that may
	 * start runs (ADR 4).
	 */
	setMeaning: knowledgeProcedure(projectInput.extend({ on: z.boolean() }))
		.route({
			summary:
				"Turns knowledge search by meaning on or off for a project, on every computer of its Space.",
		})
		.output(output(knowledgeMeaningSchema))
		.handler(({ context, input }) =>
			context.knowledge.setMeaning(
				context.actor,
				context.spaceId,
				input.projectId,
				input.on,
			),
		),
};
