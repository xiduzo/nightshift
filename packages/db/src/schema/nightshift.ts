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
	/** Set when a person removed the project. Its runs and events stay. Adding the path again clears it. */
	removedAt: integer("removed_at", { mode: "timestamp_ms" }),
});

/** One walk of a flow in its own worktree. */
export const run = sqliteTable(
	"run",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id),
		/** The flow file the run started from. Null for a quick run. */
		flowName: text("flow_name"),
		/** JSON copy of the flow at start. The run never reads the file again. */
		flow: text("flow").notNull(),
		/** JSON copies of every flow the run can call (Subflow and For Each) at start, by flow name. */
		bodyFlows: text("body_flows").notNull().default("{}"),
		title: text("title").notNull(),
		/** Absolute path of the worktree the run works in. */
		worktreePath: text("worktree_path").notNull(),
		branch: text("branch").notNull(),
		baseRef: text("base_ref").notNull(),
		createdAt: createdAt(),
	},
	(table) => [index("run_projectId_idx").on(table.projectId)],
);

/** One visit of one node. */
export const step = sqliteTable(
	"step",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => run.id),
		nodeId: text("node_id").notNull(),
		nodeType: text("node_type").notNull(),
		/** 1 for the first visit of this node in the run. */
		visit: integer("visit").notNull(),
		/** Absolute path of the step's NDJSON transcript on disk. */
		transcriptPath: text("transcript_path").notNull(),
		createdAt: createdAt(),
	},
	(table) => [index("step_runId_idx").on(table.runId)],
);

/** One harness session of an Agent step. A resume adds a row that continues the same harness session id. */
export const agentSession = sqliteTable(
	"agent_session",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => run.id),
		stepId: text("step_id")
			.notNull()
			.references(() => step.id),
		/** The harness's own session id, known after the harness starts. */
		harnessSessionId: text("harness_session_id"),
		/** The rendered prompt the session received. */
		prompt: text("prompt").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		index("agent_session_runId_idx").on(table.runId),
		index("agent_session_stepId_idx").on(table.stepId),
	],
);

/**
 * The append-only event log. One row per fact that changed. `seq` orders the
 * log globally. No foreign keys: nothing may delete a row here. Transcript
 * chunks (text deltas, tool calls, command output) stay on disk, not here.
 */
export const event = sqliteTable(
	"event",
	{
		seq: integer("seq").primaryKey({ autoIncrement: true }),
		runId: text("run_id"),
		stepId: text("step_id"),
		sessionId: text("session_id"),
		type: text("type").notNull(),
		/** JSON-encoded payload. */
		payload: text("payload").notNull().default("{}"),
		at: createdAt(),
	},
	(table) => [index("event_runId_idx").on(table.runId)],
);

const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();

/**
 * A daemon setting changed in the UI. A key without a row falls back to the
 * daemon's environment, then to the built-in default.
 */
export const setting = sqliteTable("setting", {
	key: text("key").primaryKey(),
	/** JSON-encoded value. */
	value: text("value").notNull(),
	updatedAt: updatedAt(),
});

/**
 * An MCP server defined once on this daemon. Agent nodes name it in
 * `connections`. Secrets stay `${NAME}` references, never values.
 */
export const connection = sqliteTable("connection", {
	name: text("name").primaryKey(),
	description: text("description"),
	/** JSON: the MCP server, a command (stdio) or a URL (streamable HTTP). */
	server: text("server").notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/**
 * The names of the secrets saved in the system keychain. The values live in
 * the keychain only. A `${NAME}` reads the keychain first, then the environment.
 */
export const secret = sqliteTable("secret", {
	name: text("name").primaryKey(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});
