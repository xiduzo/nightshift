import type { KnowledgeFile } from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";

/** One file of a project's knowledge folder. */
const knowledgeFileSchema = exact<KnowledgeFile>()(
	z.object({
		/** Relative to the folder, with `/` between its parts. */
		path: z.string(),
		/** Bytes. */
		size: z.number(),
		/** Epoch ms. */
		changedAt: z.number(),
	}),
);

/** A project's knowledge on this computer, and the flows that fill it. */
export const knowledgeSchema = z.object({
	/** Every file but the index, by path. */
	files: z.array(knowledgeFileSchema),
	/** So many files that an agent reads it badly. */
	tooLarge: z.boolean(),
	/** The flows of the project that call a `kit:knowledge/*` kit to fill it, by name. */
	syncs: z.array(z.object({ flow: z.string(), kits: z.array(z.string()) })),
	/** How many learnings agents proposed that wait for a person. */
	proposed: z.number(),
	/** The flows of the project that review the learnings, by name. */
	reviews: z.array(z.string()),
});
export type KnowledgeView = z.infer<typeof knowledgeSchema>;
