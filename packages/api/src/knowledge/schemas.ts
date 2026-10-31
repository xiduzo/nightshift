import type {
	AskedQuestion,
	KnowledgeEvaluation,
	KnowledgeFile,
	KnowledgeHit,
	KnowledgeMeaningStatus,
	KnowledgeQuestion,
	KnowledgeText,
	KnowledgeUseReport,
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
			/** Its last sync failed, or it has not synced in a week. Null: nothing to do. */
			health: z.enum(["failed", "stale"]).nullable(),
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
		/** Start runs: sync a source now, review the learnings, remove a source's files, mark questions, turn search by meaning on or off. */
		startRuns: z.boolean(),
		/** Change when a source syncs on its own: this computer's owner only. */
		schedules: z.boolean(),
	}),
	/** The Host that keeps the Space runs an older version of Night Shift: it cannot take this knowledge yet. */
	olderHost: z.boolean(),
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
		 * `off`: search by meaning is off. `turned-off`: a person turned it
		 * off for the project. `no-ollama`: Ollama does not answer.
		 * `no-model`: Ollama does not have the model. `downloading`: the
		 * model is on its way. `preparing`: the first vectors are on their
		 * way. `on`: search finds by meaning.
		 */
		state: z.enum([
			"off",
			"turned-off",
			"no-ollama",
			"no-model",
			"downloading",
			"preparing",
			"on",
		]),
		/** The embedding model. Null when it is off. */
		model: z.string().nullable(),
		/** Sections with a vector, of `total`. */
		done: z.number(),
		total: z.number(),
		/** Where the model runs: null on this computer, else the host name of its Ollama. */
		where: z.string().nullable(),
		/** While `downloading`: how far the download of the model is, in percent. */
		percent: z.number().nullable(),
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
		/** Where the text starts, for a read from a spot. Absent: the start of the file. */
		from: z
			.object({ line: z.number(), page: z.number().nullable() })
			.optional(),
	}),
);

/** Where a search put a file: its section, and how it found it. */
const useHitSchema = z.object({
	path: z.string(),
	section: z.string().nullable(),
	line: z.number(),
	page: z.number().nullable(),
	found: z.array(z.enum(["words", "meaning"])),
});

/** A question of the project's question set, and the files that answer it. */
const knowledgeQuestionSchema = exact<KnowledgeQuestion>()(
	z.object({
		query: z.string(),
		answers: z.array(z.string()),
		markedAt: z.number(),
		by: z.string().nullable(),
	}),
);

/** A question agents asked, what its last asking found, and its answers when it is in the set. */
const askedQuestionSchema = exact<AskedQuestion>()(
	z.object({
		query: z.string(),
		times: z.number(),
		lastAt: z.number(),
		runId: z.string().nullable(),
		stepId: z.string().nullable(),
		hits: z.array(useHitSchema),
	}),
).extend({
	/** The files a person marked as its answer. Null: not in the question set. */
	answers: z.array(z.string()).nullable(),
});

/** The questions agents asked a project's knowledge, and its question set. */
export const knowledgeQuestionsSchema = z.object({
	asked: z.array(askedQuestionSchema),
	set: z.array(knowledgeQuestionSchema),
});

const modeResultSchema = z
	.object({
		/** Questions with a right file in the top `k`. */
		found: z.number(),
		/** `found` of all questions, 0 to 1. */
		recall: z.number(),
		/** The mean of 1 / rank of the first right file. */
		mrr: z.number(),
	})
	.nullable();

const rankSchema = z.number().nullable();

/** The question set against each way to search: recall at 5, and the rank of each question's first right file. */
export const knowledgeEvaluationSchema = exact<KnowledgeEvaluation>()(
	z.object({
		at: z.number(),
		questions: z.number(),
		k: z.number(),
		minQuestions: z.number(),
		minGainPoints: z.number(),
		meaning: knowledgeMeaningSchema,
		modes: z.object({
			words: modeResultSchema,
			meaning: modeResultSchema,
			both: modeResultSchema,
		}),
		rows: z.array(
			z.object({
				query: z.string(),
				answers: z.array(z.string()),
				ranks: z.object({
					words: rankSchema,
					meaning: rankSchema,
					both: rankSchema,
				}),
			}),
		),
		/** `too-few`: fewer marked questions than `minQuestions`. `keep`: search by meaning finds more. `turn-off`: words alone find as much. `unavailable`: search by meaning does not work now. */
		advice: z.enum(["too-few", "keep", "turn-off", "unavailable"]),
	}),
);

/** How agents used each file of a project's knowledge, and which files no run used lately. */
export const knowledgeUseSchema = exact<KnowledgeUseReport>()(
	z.object({
		since: z.number(),
		unusedDays: z.number(),
		runsUsedIt: z.boolean(),
		files: z.array(
			z.object({
				path: z.string(),
				found: z.number(),
				read: z.number(),
				lastAt: z.number(),
				lastRunAt: z.number().nullable(),
			}),
		),
	}),
);
