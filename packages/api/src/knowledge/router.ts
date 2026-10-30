import { KNOWLEDGE_FILES_WARNING } from "@nightshift/engine";
import { knowledgeKitsOf } from "@nightshift/flows";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { type KnowledgeView, knowledgeSchema } from "./schemas";

export const knowledge = {
	/**
	 * The project's knowledge folder on this computer, with a fresh index,
	 * and the flows that fill it. The owner's: it is this computer's disk.
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
			const files = await context.knowledge.index(input.projectId);
			const syncs = Object.entries(flows)
				.flatMap(([flow, parsed]) => {
					const kits = parsed ? knowledgeKitsOf(parsed) : [];
					return kits.length > 0 ? [{ flow, kits }] : [];
				})
				.sort((a, b) => a.flow.localeCompare(b.flow));
			return {
				files,
				tooLarge: files.length > KNOWLEDGE_FILES_WARNING,
				syncs,
			};
		}),
};
