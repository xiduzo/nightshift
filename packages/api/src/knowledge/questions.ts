import { z } from "zod";

import { output } from "../output";
import { permitted } from "../procedures";
import { projectProcedure } from "../projects";
import { MAY, projectInput } from "./access";
import { knowledgeEvaluationSchema, knowledgeQuestionsSchema } from "./schemas";

/**
 * The questions agents asked a project's knowledge, and the question set
 * that measures its search.
 */
export const knowledgeQuestions = {
	/**
	 * The questions agents asked the project's knowledge, newest first, with
	 * what each last asking found, and the project's question set: the
	 * questions a person marked with the files that answer them.
	 */
	questions: projectProcedure(
		projectInput.extend({
			limit: z.number().int().min(1).max(200).optional(),
		}),
	)
		.route({
			summary:
				"Lists the questions agents asked a project's knowledge, what they found, and the project's question set.",
		})
		.output(output(knowledgeQuestionsSchema))
		.handler(({ context, input }) =>
			context.knowledge.questions(input.projectId, {
				...(input.limit !== undefined ? { limit: input.limit } : {}),
			}),
		),
	/**
	 * Marks the files that answer a question an agent asked: the question
	 * joins the project's question set, which syncs with the knowledge.
	 * No files takes it out. It changes the knowledge, so it asks a role
	 * that may start runs (ADR 4). Returns the set.
	 */
	markQuestion: projectProcedure(
		projectInput.extend({
			query: z.string().trim().min(1).max(1000),
			answers: z.array(z.string().min(1).max(1000)).max(20),
		}),
		permitted(MAY.changeKnowledge),
	)
		.route({
			summary:
				"Marks the files that answer a question agents asked, for the project's question set. No files takes the question out.",
		})
		.output(output(knowledgeQuestionsSchema.shape.set))
		.handler(({ context, input }) =>
			context.knowledge.markQuestion(input.projectId, {
				query: input.query,
				answers: input.answers,
				by: context.session.user.id,
			}),
		),
	/**
	 * Runs the project's question set against each way to search on this
	 * computer: by words, by meaning, and both. Recall at 5, the rank of
	 * each question's first right file, and what that says about search
	 * by meaning for the project.
	 */
	evaluate: projectProcedure(projectInput)
		.route({
			summary:
				"Runs a project's question set against knowledge search by words, by meaning and both, and reports recall at 5.",
		})
		.output(output(knowledgeEvaluationSchema))
		.handler(({ context, input }) =>
			context.knowledge.evaluate(input.projectId),
		),
};
