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
