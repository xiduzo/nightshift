import {
	blob,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

// Owner: `@nightshift/engine`, `graph/checkpointer.ts`: LangGraph's
// checkpoints and pending writes. `graph/walk-state.ts` puts a run's latest
// in one file of its walk state, which `@nightshift/devices` archives with a
// moved run.

/**
 * A LangGraph checkpoint: the state of one run (the thread id is the run id)
 * after one super-step. Written by the engine's `LibsqlSaver`, read back on
 * resume. Only the latest of each namespace is kept. The blobs are what LangGraph's serializer produced; `type` names
 * the encoding.
 */
export const lgCheckpoint = sqliteTable(
	"lg_checkpoint",
	{
		threadId: text("thread_id").notNull(),
		/** Empty for the root graph; a subgraph (the body of a Call node) checkpoints under its own namespace. */
		checkpointNs: text("checkpoint_ns").notNull().default(""),
		checkpointId: text("checkpoint_id").notNull(),
		parentCheckpointId: text("parent_checkpoint_id"),
		type: text("type"),
		checkpoint: blob("checkpoint", { mode: "buffer" }),
		metadata: blob("metadata", { mode: "buffer" }),
	},
	(table) => [
		primaryKey({
			columns: [table.threadId, table.checkpointNs, table.checkpointId],
		}),
	],
);

/**
 * A pending write: what one task of a super-step wrote to a channel before
 * the next checkpoint was taken, so a run that died mid-step keeps the work
 * of the tasks that finished.
 */
export const lgWrite = sqliteTable(
	"lg_write",
	{
		threadId: text("thread_id").notNull(),
		checkpointNs: text("checkpoint_ns").notNull().default(""),
		checkpointId: text("checkpoint_id").notNull(),
		taskId: text("task_id").notNull(),
		taskPath: text("task_path").notNull().default(""),
		idx: integer("idx").notNull(),
		channel: text("channel").notNull(),
		type: text("type"),
		value: blob("value", { mode: "buffer" }),
	},
	(table) => [
		primaryKey({
			columns: [
				table.threadId,
				table.checkpointNs,
				table.checkpointId,
				table.taskId,
				table.idx,
			],
		}),
	],
);
