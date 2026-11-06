import { type Permissions, ROLE_REFUSAL } from "@nightshift/auth";
import {
	flowNameSchema,
	isTimeZone,
	knowledgeSourceSchema,
} from "@nightshift/flows";
import { z } from "zod";

import type { Context } from "../context";
import { flowIssueSchema } from "../flows";
import { output } from "../output";
import {
	ownsThisComputer,
	permitted,
	protectedProcedure,
	refusalError,
} from "../procedures";
import { projectIn, projectProcedure } from "../projects";
import { runSummarySchema } from "../runs";
import {
	type KnowledgePage,
	knowledgeEvaluationSchema,
	knowledgeFileSchema,
	knowledgeHitSchema,
	knowledgeMapSchema,
	knowledgeMeaningSchema,
	knowledgeQuestionsSchema,
	knowledgeSchema,
	knowledgeTextSchema,
	knowledgeUseSchema,
	listedLearningSchema,
	reviewTaskSchema,
} from "./schemas";

/** What the person may change: this computer's schedules are its owner's. */
function rightsOf(context: Pick<Context, "access" | "daemon">) {
	return { schedules: ownsThisComputer(context) };
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

/** The most of one file `knowledge.read` returns. */
const READ_MAX_BYTES = 1024 * 1024;

/** A project of the Space. */
const projectInput = z.object({ projectId: z.string() });

/** One step's proposed learnings that wait, in a project of the Space. */
const learningInput = projectInput.extend({ id: z.string().min(1).max(300) });

/**
 * A project's knowledge belongs to its Space (ADR 4): every Member of the
 * Space reads it, on any of its Devices and on its Host. A browser changes
 * it only through flows (the syncs) and the review of learnings. Each
 * procedure keyed by a project checks it is the Space's first
 * (`projectProcedure`).
 */
export const knowledge = {
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
	 * The learnings agents proposed that wait for a person, newest first:
	 * of one project, or of every project of the Space. Each is one step's
	 * proposed learnings, with its notes and the run that proposed them.
	 */
	learnings: protectedProcedure
		.route({
			summary:
				"Lists the learnings agents proposed that wait for a person, of one project or of every project of the Space, newest first.",
		})
		.output(output(z.array(listedLearningSchema)))
		.input(z.object({ projectId: z.string().optional() }).optional())
		.handler(async ({ context, input }) => {
			const projectId = input?.projectId;
			const projectIds =
				projectId !== undefined
					? [(await projectIn(context, projectId)).projectId]
					: (await context.space.listProjects()).map(({ id }) => id);
			const [learnings, mayDecide] = await Promise.all([
				context.knowledge.learnings(projectIds),
				context.access.can(MAY.changeKnowledge),
			]);
			return learnings.map((learning) => ({ ...learning, mayDecide }));
		}),
	/**
	 * Keeps one step's proposed learnings: agents read them in later runs. As the
	 * review of learnings does, it changes the knowledge, so it asks a
	 * role that may start runs (ADR 4).
	 */
	keepLearning: projectProcedure(learningInput, permitted(MAY.changeKnowledge))
		.route({
			summary:
				"Keeps the learnings of one step in the project's knowledge, where agents read them.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.knowledge.settleLearning(input.projectId, input.id, "keep"),
		),
	/** Deletes one step's proposed learnings. A role that may start runs, as for keep. */
	deleteLearning: projectProcedure(
		learningInput,
		permitted(MAY.changeKnowledge),
	)
		.route({
			summary: "Deletes the learnings of one step: agents never read them.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.knowledge.settleLearning(input.projectId, input.id, "delete"),
		),
	/**
	 * Adds a source to the project's knowledge, or changes one the page
	 * added (`name`): its flow, which calls the kit with the values given
	 * (`saveKnowledgeSource`), and with `keepUpToDate` its schedule (null
	 * removes it). A source that reads a folder of this computer runs its
	 * schedule here. Saving a flow is for a role that may save flows; a
	 * schedule is this computer's owner's. Returns the flow's name and its
	 * problems.
	 */
	saveSource: projectProcedure(
		projectInput.extend({
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
		permitted(MAY.save),
	)
		.route({
			summary:
				"Adds a source to a project's knowledge, or changes one: a flow that calls a knowledge kit, and its schedule.",
		})
		.output(
			output(z.object({ name: z.string(), issues: z.array(flowIssueSchema) })),
		)
		.handler(({ context, input }) => {
			const { projectId, ...source } = input;
			return context.knowledge
				.sources(context.space)
				.save(projectId, source, rightsOf(context));
		}),
	/**
	 * Removes a source the page added: its flow and its schedules, and with
	 * `removeFiles` the files of its folder in the knowledge, for every
	 * computer of the Space. A folder another flow fills stays. Removing
	 * files changes the knowledge, so it asks a role that may start runs
	 * (ADR 4). Returns how many files it removed.
	 */
	removeSource: projectProcedure(
		projectInput.extend({ name: flowNameSchema, removeFiles: z.boolean() }),
		permitted(MAY.remove),
	)
		.route({
			summary:
				"Removes a source from a project's knowledge: its flow, its schedules and, if asked, its files.",
		})
		.output(output(z.object({ removedFiles: z.number() })))
		.handler(async ({ context, input }) => {
			// Removing files changes the knowledge: a role that may start runs (ADR 4).
			if (
				input.removeFiles &&
				!(await context.access.can(MAY.changeKnowledge))
			) {
				throw refusalError(ROLE_REFUSAL);
			}
			return context.knowledge
				.sources(context.space)
				.remove(
					input.projectId,
					input.name,
					{ files: input.removeFiles },
					rightsOf(context),
				);
		}),
	/**
	 * Syncs a source the page added now: a run of its flow. A folder
	 * source's Subflow runs on the computer that has the folder.
	 */
	syncSource: projectProcedure(
		projectInput.extend({ name: flowNameSchema }),
		permitted(MAY.changeKnowledge),
	)
		.route({
			summary:
				"Syncs a knowledge source now: starts a run of its flow where its schedule runs it.",
		})
		.output(output(runSummarySchema))
		.handler(({ context, input }) =>
			context.knowledge
				.sources(context.space)
				.sync(input.projectId, input.name, context.session.user.id),
		),
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
	/**
	 * Turns search by meaning on or off for the project, on every computer
	 * of its Space. It changes the knowledge, so it asks a role that may
	 * start runs (ADR 4).
	 */
	setMeaning: projectProcedure(
		projectInput.extend({ on: z.boolean() }),
		permitted(MAY.changeKnowledge),
	)
		.route({
			summary:
				"Turns knowledge search by meaning on or off for a project, on every computer of its Space.",
		})
		.output(output(knowledgeMeaningSchema))
		.handler(({ context, input }) =>
			context.knowledge.setMeaning(input.projectId, input.on),
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
