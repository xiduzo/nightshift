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
	/** Its Flow revision (null: none). */
	flowRevision: z.string().nullable(),
	/** The Flow revisions of its called flows, by name (JSON). */
	bodyFlowRevisions: z.string(),
	title: z.string(),
	worktreePath: z.string(),
	branch: z.string(),
	baseRef: z.string(),
	walkerId: z.string().min(1),
	/**
	 * The Person who started it, as the Host knows them (null: a schedule,
	 * or before Members).
	 */
	startedBy: z.string().nullable(),
	/** The Device its steps run on (null: the Walker). */
	deviceId: z.string().nullable(),
	/** The Devices its nodes name (JSON). */
	placements: z.string().nullable(),
	/** The names of its Devices, by id (JSON): with the two above, its plan. */
	deviceNames: z.string().nullable(),
	/** The fallbacks of its plan (JSON). */
	fallbacks: z.string().nullable(),
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
	/**
	 * The event's payload as JSON, in the shape of this version: every
	 * `RunEnded` has its `endReason`, and no `WorktreeRemoved` has `by`
	 * (migration `run_end_codes`, version 3). Version 3 also has the step
	 * event `AnswerQueued` and the warning kind `answer-dropped`. The
	 * description says it, so the hash of the contract sees a change of
	 * meaning under one shape.
	 */
	payload: z
		.string()
		.describe(
			"The event payload as JSON. Every RunEnded has its endReason, and AnswerQueued and the RunWarned kind answer-dropped exist (version 3).",
		),
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
