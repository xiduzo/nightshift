import {
	COMMAND_KINDS,
	type FeedStep,
	type RunCommandInput,
	runCommandSchema,
} from "@nightshift/engine";
import { z } from "zod";
import { exact } from "../procedure";
import {
	type RunRows,
	runRowsSchema,
	type SyncCursors,
	syncCursorsSchema,
} from "./rows";

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

/** One answer of the exchange: rows after the Device's cursors. */
export type SyncBatch = {
	rows: RunRows;
	/** The cursors moved past these rows. */
	cursors: SyncCursors;
	/**
	 * The steps of runs the Device walks that someone follows now, with the
	 * `seq` to send from: their live transcripts go to `archive.tail`.
	 * The whole set each time; a step that left it is no longer wanted.
	 */
	follows: FollowWant[];
};

/** A person's action on a run another Device walks, on its way to that Walker: the Command, with its row. */
const keptCommandSchema = exact<RunCommand>()(
	runCommandSchema({
		id: z.string(),
		spaceId: z.string(),
		runId: z.string(),
		walkerId: z.string(),
		/** Who asked, on the Host. */
		personId: z.string(),
		createdAt: z.number(),
	}),
);

/**
 * The Commands that wait for a Device, as the Walker of their runs: the
 * whole set each time it changes (`sync.commands`). A Command it lacks
 * is done there.
 */
export type CommandBatch = { commands: RunCommand[] };

/** The Commands that wait for a Device, as the Host describes them (`CommandBatch`). */
export const commandBatchSchema = exact<CommandBatch>()(
	z.object({ commands: z.array(keptCommandSchema) }),
);

/**
 * A Command that waits on the Host for another Device, as a Device that
 * does not walk its run knows of it: enough to say an action is on its
 * way, without what it carries.
 */
export type PendingElsewhere = Pick<
	RunCommand,
	"id" | "spaceId" | "runId" | "kind" | "createdAt"
>;

/**
 * The Commands that wait on the Host for Devices other than the caller,
 * in the Spaces of the caller's Person: the whole set each time it
 * changes (`sync.pending`). A Command it lacks is done there.
 */
export type PendingBatch = { commands: PendingElsewhere[] };

/** The Commands that wait for other Devices, as the Host describes them (`PendingBatch`). */
export const pendingBatchSchema = exact<PendingBatch>()(
	z.object({
		commands: z.array(
			z.object({
				id: z.string(),
				spaceId: z.string(),
				runId: z.string(),
				kind: z.enum(COMMAND_KINDS),
				createdAt: z.number(),
			}),
		),
	}),
);

/** One answer of the exchange, as the Host describes it (`SyncBatch`). */
export const syncBatchSchema = exact<SyncBatch>()(
	z.object({
		rows: runRowsSchema,
		cursors: syncCursorsSchema,
		follows: z.array(followWantSchema),
	}),
);
