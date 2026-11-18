import { type CopyStamp, LOCAL_ONLY_BYTES } from "@nightshift/engine";
import { z } from "zod";

/** Ids that become path segments: no separators, no dots. */
const segment = z.string().regex(/^[\w-]{1,128}$/);

export const archiveRefSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.enum(["transcript", "log"]),
		spaceId: segment,
		runId: segment,
		stepId: segment,
	}),
	z.object({ kind: z.literal("checkpoint"), spaceId: segment, runId: segment }),
]);
/** One file of the archive. */
export type ArchiveRef = z.infer<typeof archiveRefSchema>;

/**
 * Which end of its step a copy of a step's file holds (the engine's
 * `CopyStamp`). A Walker of an older version puts none.
 */
export const copyStampSchema = z.object({
	opening: z.number().int().positive(),
	ended: z.boolean(),
}) satisfies z.ZodType<CopyStamp>;

/**
 * Knowledge content by its hash, in the archive of the Host that keeps a
 * Space (ADR 4). Content never changes after it is written.
 */
export const knowledgeRefSchema = z.object({
	spaceId: segment,
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
/** One knowledge file's content in the archive. */
export type KnowledgeRef = z.infer<typeof knowledgeRefSchema>;

/**
 * The most knowledge content one call carries, in base64: a file of 10 MB
 * (`LOCAL_ONLY_BYTES`). A larger one stays on its Device.
 */
export const KNOWLEDGE_CONTENT_MAX = Math.ceil(LOCAL_ONLY_BYTES / 3) * 4;
