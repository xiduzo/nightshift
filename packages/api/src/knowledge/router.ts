import { KNOWLEDGE_FILES_WARNING } from "@nightshift/engine";
import { knowledgeKitsOf, REVIEW_LEARNINGS_KIT } from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { type KnowledgeView, knowledgeSchema } from "./schemas";

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
};
