import type {
	KnowledgeFile,
	KnowledgeHit,
	KnowledgeMeaningStatus,
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
	/** What the person may do with the sources: the server refuses the rest. */
	can: z.object({
		/** Add a source, or edit one. */
		save: z.boolean(),
		/** Remove a source. */
		remove: z.boolean(),
		/** Start runs: sync a source now, review the learnings, remove a source's files. */
		startRuns: z.boolean(),
		/** Change when a source syncs on its own: this computer's owner only. */
		schedules: z.boolean(),
	}),
});
export type KnowledgeView = z.infer<typeof knowledgeSchema>;

/** A file a knowledge search found. */
export const knowledgeHitSchema = exact<KnowledgeHit>()(
	z.object({
		/** Relative to the folder, with `/` between its parts. */
		path: z.string(),
		title: z.string(),
		/** The heading of the section the hit is in. Null: no heading above it. */
		section: z.string().nullable(),
		/** The line where that section starts, from 1: of the file, or of its page. */
		line: z.number(),
		/** The page of a PDF that section is on, from 1. Null: the file has no pages. */
		page: z.number().nullable(),
		/** A short excerpt of the section. `match` parts are the words found. */
		snippet: z.array(z.object({ text: z.string(), match: z.boolean() })),
		/** How well it matches: higher is better, within one search. */
		score: z.number(),
		/** How the search found it: by its words, by its meaning, or both. */
		found: z.array(z.enum(["words", "meaning"])),
	}),
);

/** Whether search by meaning works for a project on this computer. */
export const knowledgeMeaningSchema = exact<KnowledgeMeaningStatus>()(
	z.object({
		/**
		 * `off`: no model is set up. `no-ollama`: Ollama does not answer.
		 * `no-model`: Ollama does not have the model. `preparing`: the first
		 * vectors are on their way. `on`: search finds by meaning.
		 */
		state: z.enum(["off", "no-ollama", "no-model", "preparing", "on"]),
		/** The embedding model. Null when it is off. */
		model: z.string().nullable(),
		/** Sections with a vector, of `total`. */
		done: z.number(),
		total: z.number(),
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
