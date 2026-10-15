import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Durable facts only. Status is derived from the event log, never stored.

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();

/** A local clone that runs can start in. */
export const project = sqliteTable("project", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	/** Absolute path of the user's own clone. */
	repoPath: text("repo_path").notNull().unique(),
	createdAt: createdAt(),
});

/** One execution against a project. In Slice 1 a run is one Agent node. */
export const run = sqliteTable(
	"run",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		prompt: text("prompt").notNull(),
		harness: text("harness").notNull(),
		model: text("model").notNull(),
		permissionMode: text("permission_mode").notNull(),
		effort: text("effort"),
		/** Absolute path of the worktree the run works in. */
		worktreePath: text("worktree_path").notNull(),
		branch: text("branch").notNull(),
		baseRef: text("base_ref").notNull(),
		createdAt: createdAt(),
	},
	(table) => [index("run_projectId_idx").on(table.projectId)],
);

/** One harness session of a run. A resume continues the same harness session id in a new row. */
export const agentSession = sqliteTable(
	"agent_session",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => run.id, { onDelete: "cascade" }),
		/** The harness's own session id, known after the harness starts. */
		harnessSessionId: text("harness_session_id"),
		prompt: text("prompt").notNull(),
		/** Absolute path of the NDJSON transcript file on disk. */
		transcriptPath: text("transcript_path").notNull(),
		createdAt: createdAt(),
	},
	(table) => [index("agent_session_runId_idx").on(table.runId)],
);

/**
 * The append-only event log. One row per fact that changed. `seq` orders the
 * log globally. Transcript chunks (text deltas, tool calls) stay on disk, not here.
 */
export const event = sqliteTable(
	"event",
	{
		seq: integer("seq").primaryKey({ autoIncrement: true }),
		runId: text("run_id").references(() => run.id, { onDelete: "cascade" }),
		sessionId: text("session_id"),
		type: text("type").notNull(),
		/** JSON-encoded payload. */
		payload: text("payload").notNull().default("{}"),
		at: createdAt(),
	},
	(table) => [index("event_runId_idx").on(table.runId)],
);
