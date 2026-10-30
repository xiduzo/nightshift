import { KNOWLEDGE_FILES_WARNING } from "@nightshift/engine";
import { knowledgeKitsOf, REVIEW_LEARNINGS_KIT } from "@nightshift/flows";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import {
	type KnowledgeView,
	knowledgeHitSchema,
	knowledgeSchema,
	knowledgeTextSchema,
} from "./schemas";

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

export const knowledge = {
	/**
	 * The project's knowledge folder on this computer, with a fresh index,
	 * the flows that fill it, and the learnings that wait for a person. The owner's: it is this computer's disk.
	 */
	get: ownerProcedure
		.route({
			summary:
				"Lists the files of a project's knowledge on this computer, and the flows of the project that fill it.",
		})
		.output(output(knowledgeSchema))
		.input(z.object({ projectId: z.string() }))
		.handler(async ({ context, input }): Promise<KnowledgeView> => {
			// The project is the Space's: an unknown one refuses here.
			const flows = await context.space.flows.map(input.projectId);
			const [files, proposed] = await Promise.all([
				context.knowledge.index(input.projectId),
				context.knowledge.proposed(input.projectId),
			]);
			const used = Object.entries(flows)
				.map(([flow, parsed]) => ({
					flow,
					kits: parsed ? knowledgeKitsOf(parsed) : [],
				}))
				.sort((a, b) => a.flow.localeCompare(b.flow));
			return {
				files,
				tooLarge: files.length > KNOWLEDGE_FILES_WARNING,
				syncs: used.flatMap(({ flow, kits }) => {
					const fills = kits.filter((kit) => kit !== REVIEW_LEARNINGS_KIT);
					return fills.length > 0 ? [{ flow, kits: fills }] : [];
				}),
				proposed,
				reviews: used
					.filter(({ kits }) => kits.includes(REVIEW_LEARNINGS_KIT))
					.map(({ flow }) => flow),
			};
		}),
	/**
	 * The files of a project's knowledge on this computer that best match
	 * the words, best first, each with an excerpt. Keyword search (BM25):
	 * every word must match, else some of them. "a phrase" in quotes keeps
	 * its words together, and a word ending in `*` matches as a prefix.
	 */
	search: ownerProcedure
		.route({
			summary:
				"Searches the files of a project's knowledge on this computer by keyword, best match first.",
		})
		.output(output(z.array(knowledgeHitSchema)))
		.input(
			z.object({
				projectId: z.string(),
				query: z.string().max(1000),
				limit: z.number().int().min(1).max(50).optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			return context.knowledgeSearch.search(input.projectId, input.query, {
				...(input.limit !== undefined ? { limit: input.limit } : {}),
			});
		}),
	/** One file of a project's knowledge on this computer, by its path. Null: no such file. */
	read: ownerProcedure
		.route({
			summary:
				"Reads one file of a project's knowledge on this computer, by its path in the knowledge.",
		})
		.output(output(knowledgeTextSchema.nullable()))
		.input(
			z.object({
				projectId: z.string(),
				path: z.string().min(1).max(1000),
				maxBytes: z.number().int().min(1).max(READ_MAX_BYTES).optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			await knownProject(context.space, input.projectId);
			return context.knowledgeSearch.read(input.projectId, input.path, {
				maxBytes: input.maxBytes ?? READ_MAX_BYTES,
			});
		}),
};
