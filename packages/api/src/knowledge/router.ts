import { useHit } from "@nightshift/agents/tools";
import { type Permissions, ROLE_REFUSAL } from "@nightshift/auth";
import {
	askedQuestions,
	evaluateKnowledge,
	knowledgeFileUse,
	knowledgeSources,
	questionKey,
} from "@nightshift/engine";
import {
	flowNameSchema,
	isTimeZone,
	knowledgeSourceSchema,
} from "@nightshift/flows";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { flowIssueSchema } from "../flows";
import { output } from "../output";
import { permitted, protectedProcedure, refusalError } from "../procedures";
import { runSummarySchema } from "../runs";
import {
	type KnowledgeView,
	knowledgeEvaluationSchema,
	knowledgeHitSchema,
	knowledgeMeaningSchema,
	knowledgeQuestionsSchema,
	knowledgeSchema,
	knowledgeTextSchema,
	knowledgeUseSchema,
} from "./schemas";

/** The knowledge sources of the Space the person works in, from this computer. */
function sourcesOf(
	context: Pick<Context, "knowledge" | "daemon"> & {
		space: Parameters<typeof knowledgeSources>[0]["space"];
	},
) {
	return knowledgeSources({
		space: context.space,
		files: context.knowledge,
		deviceName: context.daemon.device.name,
	});
}

/** What the person may change: this computer's schedules are its owner's. */
function rightsOf(context: Pick<Context, "access" | "daemon">) {
	return {
		schedules:
			context.access.session?.user.id === context.daemon.device.ownerId,
	};
}

/**
 * The roles each change of a source needs, for its procedure and for what
 * `knowledge.get` says the person may do. Adding or editing a source saves
 * a flow. Removing one removes a flow. Syncing one, and removing its
 * files, changes the knowledge: a role that may start runs (ADR 4).
 */
const MAY = {
	save: { flow: ["save"] },
	remove: { flow: ["remove"] },
	changeKnowledge: { run: ["start"] },
} satisfies Record<string, Permissions>;

/** The clock of the person who saves a schedule, such as `Europe/Amsterdam`. */
const timeZoneSchema = z.string().refine(isTimeZone, {
	message: "Choose a time zone such as Europe/Amsterdam.",
});

/**
 * An agent asks, through the nightshift MCP server: the search or the read
 * is logged, for the Knowledge page. The page's own searches are not.
 */
const agentSchema = z.boolean().optional();

/** Logs an agent's use; a failed write does not fail the answer. */
function logUse(
	context: Pick<Context, "engine">,
	...args: Parameters<Context["engine"]["logKnowledgeUse"]>
): Promise<void> {
	return context.engine.logKnowledgeUse(...args).catch((error) => {
		console.warn("A use of the knowledge was not logged:", error);
	});
}

/** The most of one file `knowledge.read` returns. */
const READ_MAX_BYTES = 1024 * 1024;

/** Refuses a project the Space does not have: cheap, for a search on each key. */
async function knownProject(
	space: { listProjects(): Promise<{ id: string }[]> },
	projectId: string,
): Promise<void> {
	const projects = await space.listProjects();
	if (!projects.some((project) => project.id === projectId)) {
		throw new ORPCError("NOT_FOUND", {
			message: "This Space has no such project.",
		});
	}
}

/**
 * A project's knowledge belongs to its Space (ADR 4): every Member of the
 * Space reads it, on any of its Devices and on its Host. A browser changes
 * it only through flows (the syncs) and the review of learnings.
 */
export const knowledge = {
	/**
	 * The files of the project's knowledge, as its Space lists them (after
	 * a reconcile of this computer's folder), the flows that fill it, and
	 * the learnings that wait for a person.
	 */
	get: protectedProcedure
		.route({
			summary:
				"Lists the files of a project's knowledge in its Space, and the flows of the project that fill it.",
		})
		.output(output(knowledgeSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(async ({ context, input }): Promise<KnowledgeView> => {
			const [view, save, remove, changeKnowledge] = await Promise.all([
				sourcesOf(context).list(input.projectId),
				context.access.can(MAY.save),
				context.access.can(MAY.remove),
				context.access.can(MAY.changeKnowledge),
			]);
			return {
				...view,
				can: {
					save,
					remove,
					startRuns: changeKnowledge,
					schedules: rightsOf(context).schedules,
				},
			};
		}),
	/**
	 * Adds a source to the project's knowledge, or changes one the page
	 * added (`name`): its flow, which calls the kit with the values given
	 * (`saveKnowledgeSource`), and with `keepUpToDate` its schedule (null
	 * removes it). A source that reads a folder of this computer runs its
	 * schedule here. Saving a flow is for a role that may save flows; a
	 * schedule is this computer's owner's. Returns the flow's name and its
	 * problems.
	 */
	saveSource: permitted(MAY.save)
		.route({
			summary:
				"Adds a source to a project's knowledge, or changes one: a flow that calls a knowledge kit, and its schedule.",
		})
		.output(
			output(z.object({ name: z.string(), issues: z.array(flowIssueSchema) })),
		)
		.input(
			z.object({
				projectId: z.string(),
				/** The source to change. Unset: a new one. */
				name: flowNameSchema.optional(),
				source: knowledgeSourceSchema,
				/** When it syncs on its own: a cron line. Null: never. Unset: as it was. */
				keepUpToDate: z
					.object({ cron: z.string().trim().min(1) })
					.nullable()
					.optional(),
				timeZone: timeZoneSchema.optional(),
			}),
		)
		.handler(({ context, input }) => {
			const { projectId, ...source } = input;
			return sourcesOf(context).save(projectId, source, rightsOf(context));
		}),
	/**
	 * Removes a source the page added: its flow and its schedules, and with
	 * `removeFiles` the files of its folder in the knowledge, for every
	 * computer of the Space. A folder another flow fills stays. Removing
	 * files changes the knowledge, so it asks a role that may start runs
	 * (ADR 4). Returns how many files it removed.
	 */
	removeSource: permitted(MAY.remove)
		.route({
			summary:
				"Removes a source from a project's knowledge: its flow, its schedules and, if asked, its files.",
		})
		.output(output(z.object({ removedFiles: z.number() })))
		.input(
			z.object({
				projectId: z.string(),
				name: flowNameSchema,
				removeFiles: z.boolean(),
			}),
		)
		.handler(async ({ context, input }) => {
			// Removing files changes the knowledge: a role that may start runs (ADR 4).
			if (
				input.removeFiles &&
				!(await context.access.can(MAY.changeKnowledge))
			) {
				throw refusalError(ROLE_REFUSAL);
			}
			return sourcesOf(context).remove(
				input.projectId,
				input.name,
				{ files: input.removeFiles },
				rightsOf(context),
			);
		}),
	/**
	 * Syncs a source the page added now: a run of its flow, on the computer
	 * its schedule names when it reads a folder there.
	 */
	syncSource: permitted(MAY.changeKnowledge)
		.route({
			summary:
				"Syncs a knowledge source now: starts a run of its flow where its schedule runs it.",
		})
		.output(output(runSummarySchema))
		.input(z.object({ projectId: z.string(), name: flowNameSchema }))
		.handler(({ context, input }) =>
			sourcesOf(context).sync(
				input.projectId,
				input.name,
				context.session.user.id,
			),
		),
	/**
	 * The files of a project's knowledge on this computer that best match
	 * the words, best first, each at its best section with an excerpt. By
	 * keyword (BM25): every word must match, else some of them. "a phrase"
	 * in quotes keeps its words together, and a word ending in `*` matches
	 * as a prefix. By meaning too, when Ollama on this computer has the
	 * embedding model: both lists are fused by reciprocal rank.
	 */
	search: protectedProcedure
		.route({
			summary:
				"Searches the files of a project's knowledge on this computer by keyword, and by meaning when it can, best match first.",
		})
		.output(output(z.array(knowledgeHitSchema)))
		.input(
			z.object({
				projectId: z.string(),
				query: z.string().max(1000),
				limit: z.number().int().min(1).max(50).optional(),
				agent: agentSchema,
			}),
		)
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			const hits = await context.knowledgeSearch.search(
				input.projectId,
				input.query,
				{ ...(input.limit !== undefined ? { limit: input.limit } : {}) },
			);
			if (input.agent) {
				await logUse(context, input.projectId, {
					kind: "search",
					query: input.query.trim(),
					hits: hits.map(useHit),
				});
			}
			return hits;
		}),
	/**
	 * Whether search by meaning works for the project on this computer:
	 * off, waiting for Ollama or its model, preparing, or on.
	 */
	meaning: protectedProcedure
		.route({
			summary:
				"Says whether knowledge search finds by meaning on this computer, and how far its preparation is.",
		})
		.output(output(knowledgeMeaningSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			return context.knowledgeSearch.meaning(input.projectId);
		}),
	/**
	 * One file of a project's knowledge, by its path: this computer's copy,
	 * else its content by hash from the Space (its Host). Null: no such file.
	 */
	read: protectedProcedure
		.route({
			summary:
				"Reads one file of a project's knowledge, by its path in the knowledge.",
		})
		.output(output(knowledgeTextSchema.nullable()))
		.input(
			z.object({
				projectId: z.string(),
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
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			const file = await context.knowledge.read(
				input.projectId,
				input.path,
				input.maxBytes ?? READ_MAX_BYTES,
				input.from,
			);
			if (input.agent) {
				await logUse(context, input.projectId, {
					kind: "read",
					path: file?.path ?? input.path.trim(),
					found: file !== null,
					...(input.from ? { from: input.from } : {}),
				});
			}
			return file;
		}),
	/**
	 * The questions agents asked the project's knowledge, newest first, with
	 * what each last asking found, and the project's question set: the
	 * questions a person marked with the files that answer them.
	 */
	questions: protectedProcedure
		.route({
			summary:
				"Lists the questions agents asked a project's knowledge, what they found, and the project's question set.",
		})
		.output(output(knowledgeQuestionsSchema))
		.input(
			z.object({
				projectId: z.string(),
				limit: z.number().int().min(1).max(200).optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			const [asked, set] = await Promise.all([
				askedQuestions(context.db, input.projectId, {
					...(input.limit !== undefined ? { limit: input.limit } : {}),
				}),
				context.knowledge.questions(input.projectId),
			]);
			const answers = new Map(
				set.map((q) => [questionKey(q.query), q.answers]),
			);
			return {
				asked: asked.map((question) => ({
					...question,
					answers: answers.get(questionKey(question.query)) ?? null,
				})),
				set,
			};
		}),
	/**
	 * Marks the files that answer a question an agent asked: the question
	 * joins the project's question set, which syncs with the knowledge.
	 * No files takes it out. It changes the knowledge, so it asks a role
	 * that may start runs (ADR 4). Returns the set.
	 */
	markQuestion: permitted(MAY.changeKnowledge)
		.route({
			summary:
				"Marks the files that answer a question agents asked, for the project's question set. No files takes the question out.",
		})
		.output(output(knowledgeQuestionsSchema.shape.set))
		.input(
			z.object({
				projectId: z.string(),
				query: z.string().trim().min(1).max(1000),
				answers: z.array(z.string().min(1).max(1000)).max(20),
			}),
		)
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			return context.knowledge.markQuestion(input.projectId, {
				query: input.query,
				answers: input.answers,
				by: context.session.user.id,
			});
		}),
	/**
	 * Runs the project's question set against each way to search on this
	 * computer: by words, by meaning, and both. Recall at 5, the rank of
	 * each question's first right file, and what that says about search
	 * by meaning for the project.
	 */
	evaluate: protectedProcedure
		.route({
			summary:
				"Runs a project's question set against knowledge search by words, by meaning and both, and reports recall at 5.",
		})
		.output(output(knowledgeEvaluationSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			const questions = await context.knowledge.questions(input.projectId);
			return evaluateKnowledge(
				context.knowledgeSearch,
				input.projectId,
				questions,
			);
		}),
	/**
	 * Turns search by meaning on or off for the project, on every computer
	 * of its Space. It changes the knowledge, so it asks a role that may
	 * start runs (ADR 4).
	 */
	setMeaning: permitted(MAY.changeKnowledge)
		.route({
			summary:
				"Turns knowledge search by meaning on or off for a project, on every computer of its Space.",
		})
		.output(output(knowledgeMeaningSchema))
		.input(z.object({ projectId: z.string(), on: z.boolean() }))
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			await context.knowledge.setMeaning(input.projectId, input.on);
			return context.knowledgeSearch.meaning(input.projectId);
		}),
	/**
	 * How often agents found and read each file of the project's knowledge
	 * in the last 90 days, and when a run last used it: the page marks the
	 * files no run used in 30 days.
	 */
	use: protectedProcedure
		.route({
			summary:
				"Says how often agents found and read each file of a project's knowledge, and when a run last used it.",
		})
		.output(output(knowledgeUseSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			return knowledgeFileUse(context.db, input.projectId);
		}),
};
