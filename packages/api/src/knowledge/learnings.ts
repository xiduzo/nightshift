import { z } from "zod";

import { output } from "../output";
import { protectedProcedure } from "../procedures";
import { projectIn } from "../projects";
import { knowledgeProcedure, MAY, projectInput } from "./access";
import { listedLearningSchema } from "./schemas";

/** One step's proposed learnings that wait, in a project of the Space. */
const learningInput = projectInput.extend({ id: z.string().min(1).max(300) });

/** The longest note a person tells. */
const NOTE_MAX_CHARS = 2000;

/**
 * One note of a learning that waits: its step's file (the learning's `id`),
 * its place in `notes`, and its text as the person saw it. With the text, a
 * note that moved in its file is still found, and one that is gone is refused.
 */
const waitingNoteSchema = z.object({
	learningId: z.string().min(1).max(300),
	index: z.number().int().min(0).max(100_000),
	note: z.string().max(100_000).optional(),
});

/** The note as the Learnings module names it. */
function waitingNote(input: z.infer<typeof waitingNoteSchema>) {
	const { learningId: id, index, note } = input;
	return { id, index, ...(note !== undefined ? { note } : {}) };
}

/** The person who decides on a note: their name marks it in the knowledge. */
function notePerson(context: {
	session: { user: { id: string; name: string } };
}) {
	const { id, name } = context.session.user;
	return { id, name };
}

/**
 * The learnings agents proposed: what waits for a person, what a person
 * keeps, deletes or tells, and whether Night Shift proposes them.
 */
export const knowledgeLearnings = {
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
				context.knowledge.learnings({ projectIds }),
				context.access.can(MAY.changeKnowledge),
			]);
			return learnings.map((learning) => ({ ...learning, mayDecide }));
		}),
	/**
	 * Keeps one step's proposed learnings: agents read them in later runs. As the
	 * review of learnings does, it changes the knowledge, so it asks a
	 * role that may start runs (ADR 4).
	 */
	keepLearning: knowledgeProcedure(learningInput)
		.route({
			summary:
				"Keeps the learnings of one step in the project's knowledge, where agents read them.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.knowledge.settleLearning(context.actor, {
				spaceId: context.spaceId,
				projectId: input.projectId,
				id: input.id,
				decision: "keep",
			}),
		),
	/** Deletes one step's proposed learnings. A role that may start runs, as for keep. */
	deleteLearning: knowledgeProcedure(learningInput)
		.route({
			summary: "Deletes the learnings of one step: agents never read them.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.knowledge.settleLearning(context.actor, {
				spaceId: context.spaceId,
				projectId: input.projectId,
				id: input.id,
				decision: "delete",
			}),
		),
	/**
	 * Keeps or deletes one note of a learning that waits, not the whole
	 * step's. A kept note goes where agents read it, with who kept it and
	 * when. A role that may start runs, as for keep.
	 */
	settleNote: knowledgeProcedure(
		projectInput.extend({
			...waitingNoteSchema.shape,
			decision: z.enum(["keep", "delete"]),
		}),
	)
		.route({
			summary:
				"Keeps or deletes one note of the learnings that wait. Agents read a kept note in later runs.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.knowledge.settleNote(context.actor, {
				spaceId: context.spaceId,
				projectId: input.projectId,
				note: waitingNote(input),
				decision: input.decision,
				by: notePerson(context),
			}),
		),
	/**
	 * Keeps a note the person writes, with who told it and when: agents read
	 * it in later runs. With `replaces`, it takes the place of a note that
	 * waits ("Change it"). A role that may start runs, as for keep.
	 */
	tell: knowledgeProcedure(
		projectInput.extend({
			note: z.string().trim().min(1).max(NOTE_MAX_CHARS),
			replaces: waitingNoteSchema.optional(),
		}),
	)
		.route({
			summary:
				"Keeps a note a person writes in the project's knowledge, where agents read it, in place of a note that waits if one is given.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) => {
			const { projectId, note, replaces } = input;
			const by = notePerson(context);
			const { actor, spaceId } = context;
			return context.knowledge.tellLearning(actor, {
				spaceId,
				projectId,
				note,
				by,
				...(replaces ? { replaces: waitingNote(replaces) } : {}),
			});
		}),
	/**
	 * Turns the learnings from runs that ended on or off for the project, on
	 * every computer of its Space (ADR 37). It changes what waits in the
	 * knowledge, so it asks a role that may start runs (ADR 4).
	 */
	setLearnsFromRuns: knowledgeProcedure(
		projectInput.extend({ on: z.boolean() }),
	)
		.route({
			summary:
				"Turns on or off the learnings Night Shift proposes from the runs of a project that ended, on every computer of its Space.",
		})
		.output(output(z.object({ on: z.boolean() })))
		.handler(async ({ context, input }) => {
			await context.knowledge.setLearnsFromRuns(context.actor, {
				spaceId: context.spaceId,
				projectId: input.projectId,
				on: input.on,
			});
			return { on: input.on };
		}),
};
