import type { FeedStep, RunCommandInput } from "@nightshift/engine";
import { z } from "zod";
import type { RunRows, SyncCursors } from "./rows";

/** A command on its way to a Walker. */
export type RunCommand = RunCommandInput & {
	id: string;
	spaceId: string;
	runId: string;
	walkerId: string;
	/** Who asked, on the Host. */
	personId: string;
	createdAt: number;
};

/** A step a Host wants from its Walker, from the entry after `afterSeq`. */
export type FollowWant = FeedStep & { afterSeq: number };

/** Ids that may become archive path segments: no separators, no dots. */
const id = z.string().regex(/^[\w-]{1,128}$/);
export const feedStepSchema = z.object({
	spaceId: id,
	runId: id,
	stepId: id,
});
export const followWantSchema = feedStepSchema.extend({
	afterSeq: z.number().int().min(0),
});
/** A transcript entry on the wire. Its `event` is the Walker's, as it wrote it. */
export const transcriptEntrySchema = z.object({
	seq: z.number().int().min(1),
	stepId: id,
	sessionId: z.string().nullable(),
	at: z.number(),
	event: z.record(z.string(), z.unknown()),
});

/** One answer of the exchange: rows after the Device's cursors, and its commands. */
export type SyncBatch = {
	rows: RunRows;
	/** The cursors moved past these rows. */
	cursors: SyncCursors;
	/** The commands that wait for the Device, as the Walker of their runs. */
	commands: RunCommand[];
	/**
	 * The steps of runs the Device walks that someone follows now, with the
	 * `seq` to send from: their live transcripts go to `archive.tail`.
	 * The whole set each time; a step that left it is no longer wanted.
	 */
	follows: FollowWant[];
};
