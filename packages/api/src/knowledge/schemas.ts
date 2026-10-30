import type {
	KnowledgeFile,
	KnowledgeHit,
	KnowledgeText,
} from "@nightshift/engine";
import { knowledgeSourceSchema } from "@nightshift/flows";
import { z } from "zod";

import { exact } from "../output";
import { runStatusSchema } from "../runs";

/** One file of a project's knowledge folder. */
const knowledgeFileSchema = exact<KnowledgeFile>()(
	z.object({
		/** Relative to the folder, with `/` between its parts. */
		path: z.string(),
		/** Bytes. */
		size: z.number(),
		/** Epoch ms. */
		changedAt: z.number(),
		/** Larger than 10 MB: it stays on the computer that synced it. */
		local: z.literal(true).optional(),
	}),
);

/** A project's knowledge in its Space, and the flows that fill it. */
export const knowledgeSchema = z.object({
	/** Every file but the index, by path. */
	files: z.array(knowledgeFileSchema),
	/** So many files that an agent reads it badly. */
	tooLarge: z.boolean(),
	/** The flows of the project that call a `kit:knowledge/*` kit to fill it, by name. */
	syncs: z.array(
		z.object({
			flow: z.string(),
			kits: z.array(z.string()),
			/** The source, when the flow is one the Knowledge page made and can edit. */
			source: knowledgeSourceSchema.nullable(),
			/** Its schedule at set times, if it has one. */
			schedule: z
				.object({
					cron: z.string(),
					enabled: z.boolean(),
					/** The Device its runs run on, by name. */
					device: z.string().optional(),
				})
				.nullable(),
			/** Its latest run among the project's recent ones: when it ended, else started. */
			lastRun: z
				.object({ id: z.string(), status: runStatusSchema, at: z.number() })
				.nullable(),
		}),
	),
	/** How many learnings agents proposed that wait for a person. */
	proposed: z.number(),
	/** The flows of the project that review the learnings, by name. */
	reviews: z.array(z.string()),
	/** The project's Space is not a personal one: each of its Members reads the knowledge. */
	shared: z.boolean(),
});
export type KnowledgeView = z.infer<typeof knowledgeSchema>;

/** A file a knowledge search found. */
export const knowledgeHitSchema = exact<KnowledgeHit>()(
	z.object({
		/** Relative to the folder, with `/` between its parts. */
		path: z.string(),
		title: z.string(),
		/** A short excerpt around the best match. `match` parts are the words found. */
		snippet: z.array(z.object({ text: z.string(), match: z.boolean() })),
		/** How well it matches: higher is better, within one search. */
		score: z.number(),
	}),
);

/** One file of a project's knowledge, its text cut at the size asked for. */
export const knowledgeTextSchema = exact<KnowledgeText>()(
	z.object({
		path: z.string(),
		title: z.string(),
		text: z.string(),
		/** Bytes of the whole file. */
		size: z.number(),
		/** The text stops before the file ends. */
		truncated: z.boolean(),
	}),
);
