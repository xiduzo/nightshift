import { z } from "zod";

import { output } from "../output";
import { projectProcedure } from "../projects";
import { MAY, projectInput, rightsOf } from "./access";
import {
	type KnowledgePage,
	knowledgeSchema,
	reviewTaskSchema,
} from "./schemas";

/**
 * The Knowledge page of a project: what its knowledge holds, and what
 * waits for a person.
 */
export const knowledgeOverview = {
	/**
	 * The files of the project's knowledge, as its Space lists them (after
	 * a reconcile of this computer's folder), the flows that fill it, and
	 * the learnings that wait for a person.
	 */
	get: projectProcedure(projectInput)
		.route({
			summary:
				"Lists the files of a project's knowledge in its Space, and the flows of the project that fill it.",
		})
		.output(output(knowledgeSchema))
		.handler(async ({ context, input }): Promise<KnowledgePage> => {
			const [save, remove, startRuns] = await Promise.all([
				context.access.can(MAY.save),
				context.access.can(MAY.remove),
				context.access.can(MAY.changeKnowledge),
			]);
			const can = { save, remove, startRuns, ...rightsOf(context) };
			const view = await context.knowledge
				.sources(context.space)
				.list(input.projectId, can);
			return { ...view, can };
		}),
	/**
	 * What waits for a person on the Knowledge page, in the order a person
	 * meets it: sources that need a look, learnings, questions that found
	 * nothing and files no run used.
	 */
	review: projectProcedure(projectInput)
		.route({
			summary:
				"Lists what waits for a person on a project's Knowledge page, in the order to meet it.",
		})
		.output(output(z.array(reviewTaskSchema)))
		.handler(({ context, input }) =>
			context.knowledge.review(input.projectId, context.space),
		),
};
