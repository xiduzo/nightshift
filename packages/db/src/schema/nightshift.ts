import { sql } from "drizzle-orm";
import {
	blob,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Durable facts only. Status is derived from the event log, never stored.

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();

/**
 * A computer that runs Night Shift. Exactly one row is this computer: the
 * one with `self` set. It is made on the first start (by the migration
 * that added this table, else by `selfDevice`) with a random id that never
 * changes. `self` is this database's own knowledge: a row of another
 * Device that sync brings in never has it.
 */
export const device = sqliteTable(
	"device",
	{
		id: text("id").primaryKey(),
		/** What the person calls it. The host name until they change it. */
		name: text("name").notNull(),
		/** `process.platform`: darwin, linux, win32. */
		platform: text("platform").notNull(),
		/** The address of the Host that keeps its private configuration. Null: none yet. */
		homeHost: text("home_host"),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
		/** This computer. At most one row has it. */
		self: integer("self", { mode: "boolean" }).notNull().default(false),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("device_self_idx").on(table.self).where(sql`${table.self} = 1`),
	],
);

/**
 * A repository that runs can start in, by its remote. Its folders are its
 * Clones, one per Device at most.
 */
export const project = sqliteTable(
	"project",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		/**
		 * The `origin` URL, normalised (`github.com/owner/repo`), so the ssh
		 * and https URLs of one repository are one Project. Null for a
		 * repository without a remote: that Project has one Clone, for good.
		 */
		remote: text("remote"),
		createdAt: createdAt(),
		/** Set when a person removed the project. Its runs and events stay. Adding its folder again clears it. */
		removedAt: integer("removed_at", { mode: "timestamp_ms" }),
	},
	(table) => [uniqueIndex("project_remote_idx").on(table.remote)],
);

/** A Project's repository on one Device, at a path. Owned by that Device. */
export const clone = sqliteTable(
	"clone",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id),
		/** Absolute path of the folder on that Device. Known to its owner only. */
		path: text("path").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("clone_deviceId_path_idx").on(table.deviceId, table.path),
		uniqueIndex("clone_projectId_deviceId_idx").on(
			table.projectId,
			table.deviceId,
		),
	],
);

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
		/** JSON copies of every flow the run can call (through Call nodes) at start, by flow name. */
		bodyFlows: text("body_flows").notNull().default("{}"),
		title: text("title").notNull(),
		/** Absolute path of the worktree the run works in. */
		worktreePath: text("worktree_path").notNull(),
		branch: text("branch").notNull(),
		baseRef: text("base_ref").notNull(),
		/**
		 * The Device that walks the run and writes its events: this
		 * computer, for every run today. No foreign key: a run walked
		 * elsewhere may arrive before its Device's row.
		 */
		walkerId: text("walker_id").notNull(),
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
		/** The Device the step's body ran on: the run's Walker, until steps are placed. */
		deviceId: text("device_id"),
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
 * The append-only event log. One row per fact that changed. No foreign
 * keys: nothing may delete a row here. Transcript chunks (text deltas, tool
 * calls, command output) stay on disk, not here.
 *
 * Two orders: `seq` is this database's own, the order rows landed here (the
 * read model and the stream cursors use it). `(walker_id, walker_seq)` is
 * the event's identity everywhere: the Walker that wrote it and its count
 * of the events it wrote, 1, 2, 3, … Sync asks a Device for a Walker's
 * events after a `walker_seq`.
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
		/** The Device that wrote the event: the run's Walker, or this computer for a fact of no run. */
		walkerId: text("walker_id").notNull(),
		/** The event's number among the Walker's events. */
		walkerSeq: integer("walker_seq").notNull(),
	},
	(table) => [
		index("event_runId_idx").on(table.runId),
		uniqueIndex("event_walkerId_walkerSeq_idx").on(
			table.walkerId,
			table.walkerSeq,
		),
	],
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
 * A CLI tool: a program on this computer, by its name (`gh`, `aws`), that
 * the agents may run. Agent nodes and profiles name it in `clis`.
 */
export const cliTool = sqliteTable("cli_tool", {
	name: text("name").primaryKey(),
	description: text("description"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/**
 * An Agent Profile: a harness, a model and its tools under one name, defined
 * once on this daemon. An Agent node names it in `profile`; a run resolves it
 * into the node when it starts.
 */
export const agentProfile = sqliteTable("agent_profile", {
	name: text("name").primaryKey(),
	description: text("description"),
	/** JSON: the profile's agent settings (harness, model, effort, permission mode, CLI tools, connections). */
	settings: text("settings").notNull(),
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

/**
 * The single-writer lease: one row, held by the one daemon that may write to
 * this database. `epoch` grows by one on every acquisition, so a daemon that
 * lost the lease finds out on its next heartbeat. A null `owner` means
 * released.
 */
export const daemonLease = sqliteTable("daemon_lease", {
	/** Always 1. */
	id: integer("id").primaryKey(),
	/** A random id per daemon process. Null once released. */
	owner: text("owner"),
	host: text("host").notNull(),
	pid: integer("pid").notNull(),
	epoch: integer("epoch").notNull(),
	acquiredAt: integer("acquired_at", { mode: "timestamp_ms" }).notNull(),
	heartbeatAt: integer("heartbeat_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * A LangGraph checkpoint: the state of one run (the thread id is the run id)
 * after one super-step. Written by the engine's `LibsqlSaver`, read back on
 * resume. The blobs are what LangGraph's serializer produced; `type` names
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
