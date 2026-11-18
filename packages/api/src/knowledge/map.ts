import { z } from "zod";

import { output } from "../output";
import { permitted } from "../procedures";
import { projectProcedure } from "../projects";
import { MAY, projectInput } from "./access";
import { knowledgeMapSchema } from "./schemas";

/** The Map of a project's knowledge, and the words a person takes off it. */
export const knowledgeMap = {
	/**
	 * The Map of the project's knowledge: its files, the topics they share,
	 * the questions that found them and the learnings that name their topics.
	 * The procedure keeps the older name: it is on the wire.
	 */
	graph: projectProcedure(projectInput)
		.route({
			summary:
				"Gives the Map of a project's knowledge: its files, their topics, the files close in meaning, the questions that found them and the learnings that wait.",
		})
		.output(output(knowledgeMapSchema))
		.handler(({ context, input }) => context.knowledge.map(input.projectId)),
	/**
	 * Marks a word as not a topic on the Map, or puts it back. The list syncs
	 * with the knowledge, so every computer of the Space draws the same Map.
	 * It changes the knowledge, so it asks a role that may start runs (ADR 4).
	 * Returns the list.
	 */
	markNotTopic: projectProcedure(
		projectInput.extend({
			word: z.string().trim().min(1).max(200),
			notTopic: z.boolean(),
		}),
		permitted(MAY.changeKnowledge),
	)
		.route({
			summary:
				"Marks a word as not a topic on a project's Map, or puts it back.",
		})
		.output(output(knowledgeMapSchema.shape.notTopics))
		.handler(({ context, input }) =>
			context.knowledge.markNotTopic(input.projectId, {
				word: input.word,
				notTopic: input.notTopic,
				by: context.session.user.id,
			}),
		),
};
