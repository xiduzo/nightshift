import { z } from "zod";

/**
 * The rows of runs on the wire: one batch of the exchange, and the cursors
 * it moves. They are the engine's row types (`HistoryRows`,
 * `HistoryCursors`) as zod checks them: the exchange assigns each to the
 * other, so a change to one fails the build until the other follows.
 */

const runRowSchema = z.object({
	id: z.string().min(1),
	spaceId: z.string().min(1),
	projectId: z.string().min(1),
	flowName: z.string().nullable(),
	flow: z.string(),
	bodyFlows: z.string(),
	title: z.string(),
	worktreePath: z.string(),
	branch: z.string(),
	baseRef: z.string(),
	walkerId: z.string().min(1),
	/**
	 * The Person who started it, as the Host knows them (null: a schedule,
	 * or before Members). A Device of a version before it sends none.
	 */
	startedBy: z.string().nullable().default(null),
	/** The Device its steps run on (null: the Walker). A Device of a version before it sends none. */
	deviceId: z.string().nullable().default(null),
	/** The Devices its nodes name, by name (JSON). A Device of a version before it sends none. */
	placements: z.string().nullable().default(null),
	/**
	 * The names of its Devices, by id (JSON): with the three above, its
	 * plan. A Device of a version before it sends none; one of a version
	 * before it drops it.
	 */
	deviceNames: z.string().nullable().default(null),
	createdAt: z.number(),
});

const stepRowSchema = z.object({
	id: z.string().min(1),
	spaceId: z.string().min(1),
	runId: z.string().min(1),
	nodeId: z.string(),
	nodeType: z.string(),
	visit: z.number().int(),
	transcriptPath: z.string(),
	deviceId: z.string().nullable(),
	createdAt: z.number(),
});

const sessionRowSchema = z.object({
	id: z.string().min(1),
	spaceId: z.string().min(1),
	runId: z.string().min(1),
	stepId: z.string().min(1),
	harnessSessionId: z.string().nullable(),
	prompt: z.string(),
	createdAt: z.number(),
});

const eventRowSchema = z.object({
	spaceId: z.string().min(1),
	runId: z.string().min(1),
	stepId: z.string().nullable(),
	sessionId: z.string().nullable(),
	type: z.string().min(1),
	payload: z.string(),
	at: z.number(),
	walkerId: z.string().min(1),
	walkerSeq: z.number().int().positive(),
});

/** Rows of runs, as one batch of the exchange carries them. */
export const runRowsSchema = z.object({
	runs: z.array(runRowSchema),
	steps: z.array(stepRowSchema),
	sessions: z.array(sessionRowSchema),
	events: z.array(eventRowSchema),
});
export type RunRows = z.infer<typeof runRowsSchema>;

/** Per Space, per Walker: the last `walker_seq` a Replica has. */
export const syncCursorsSchema = z.record(
	z.string(),
	z.record(z.string(), z.number().int().nonnegative()),
);
export type SyncCursors = z.infer<typeof syncCursorsSchema>;
