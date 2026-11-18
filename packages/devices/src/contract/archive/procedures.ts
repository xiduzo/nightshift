import type { TranscriptEntry } from "@nightshift/engine";
import { z } from "zod";
import { archive, described, describedStream } from "../procedure";
import { feedStepSchema, transcriptEntrySchema } from "../sync";
import {
	archiveRefSchema,
	copyStampSchema,
	KNOWLEDGE_CONTENT_MAX,
	knowledgeRefSchema,
} from "./archive";

/** The procedures of `hostContract.archive`. */
export const archiveProcedures = {
	/** The Walker keeps a step's transcript or command log, or its run's checkpoints, here. */
	put: archive
		.route({
			summary:
				"Keeps a file of a run walked elsewhere: a transcript, a command log or checkpoints.",
		})
		.input(
			z.object({
				ref: archiveRefSchema,
				content: z.string(),
				// Which end of its step the copy holds. A Walker of an older version sends none.
				stamp: copyStampSchema.optional(),
			}),
		)
		.output(described(z.void())),
	/** A file of a run in a Space the Device's owner is in. Null when there is none. */
	get: archive
		.route({
			summary: "Reads a file of a run in the archive. Null when there is none.",
		})
		.input(z.object({ ref: archiveRefSchema }))
		.output(described(z.string().nullable())),
	/**
	 * A Device keeps the content of a knowledge file here, by its hash
	 * (ADR 4), before its entry goes into the knowledge document. Needs
	 * a role that may start runs in the Space.
	 */
	knowledgePut: archive
		.route({
			summary:
				"Keeps the content of a file of a project's knowledge, by its hash.",
		})
		.input(
			knowledgeRefSchema.extend({
				/** The content, in base64. */
				content: z.string().max(KNOWLEDGE_CONTENT_MAX),
			}),
		)
		.output(described(z.void())),
	/** The content of a knowledge file of a Space the Device's owner is in, in base64. Null when there is none. */
	knowledgeGet: archive
		.route({
			summary:
				"Reads the content of a file of a project's knowledge, by its hash. Null when there is none.",
		})
		.input(knowledgeRefSchema)
		.output(described(z.string().nullable())),
	/**
	 * A step's live transcript, for a Member of its run's Space: its
	 * entries after `afterSeq`, then each new one, until the step ends.
	 */
	follow: archive
		.route({
			summary:
				"Streams the transcript of a step: what is saved first, then each new entry.",
		})
		.input(
			z.object({ step: feedStepSchema, afterSeq: z.number().int().min(0) }),
		)
		.output(
			describedStream<typeof transcriptEntrySchema, TranscriptEntry>(
				transcriptEntrySchema,
			),
		),
	/** The Walker's live entries of a step someone follows; `ended`: the step ended. */
	tail: archive
		.route({
			summary:
				"Takes the live transcript entries of a step that someone follows.",
		})
		.input(
			z.object({
				step: feedStepSchema,
				entries: z.array(transcriptEntrySchema).max(1_000),
				ended: z.boolean(),
			}),
		)
		.output(described(z.void())),
};
