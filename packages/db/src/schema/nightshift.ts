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

/**
 * The Space a row belongs to (the tenant id): an organization's id. No
 * foreign key: a Space's rows may reach a Replica before the Space does.
 * Every query of a person reads one Space.
 */
const spaceId = () => text("space_id").notNull();

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
		/**
		 * The Person who owns the Device (a Better Auth user). This
		 * computer's owner is the Person Night Shift signs in for you.
		 */
		ownerId: text("owner_id"),
		/** This computer. At most one row has it. */
		self: integer("self", { mode: "boolean" }).notNull().default(false),
		createdAt: createdAt(),
		/**
		 * On a Host: when its owner removed the Device's access (its key is
		 * gone). Pairing it again clears it.
		 */
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		uniqueIndex("device_self_idx").on(table.self).where(sql`${table.self} = 1`),
	],
);

/**
 * This computer's link to a Host it paired with (`nightshift join`): where
 * the Host answers, which certificate it pinned, and whether the Host is its
 * home or a guest Host. The Device key itself is not here: it is in the
 * keychain, else in a file of the data directory (`key_store`).
 */
export const hostLink = sqliteTable(
	"host_link",
	{
		/** The Host's Device id. */
		hostId: text("host_id").primaryKey(),
		/** The Host's name, as it told this computer. */
		name: text("name").notNull(),
		/** JSON: the Host's addresses, in the order to try them. */
		addresses: text("addresses").notNull(),
		/**
		 * The PEM of the Host's self-signed certificate, pinned at pairing.
		 * Null when the Host's certificate is trusted by this computer, or the
		 * address is a loopback `http://` one.
		 */
		certificate: text("certificate"),
		/** The SHA-256 fingerprint of `certificate`, as shown at pairing. */
		fingerprint: text("fingerprint"),
		/** "home": the Host keeps this Device's document. "guest": shared Spaces only. */
		role: text("role", { enum: ["home", "guest"] }).notNull(),
		/** The Person on the Host whose key this is (who approved the pairing). */
		personId: text("person_id").notNull(),
		/** Where the key is: "keychain" or "file". */
		keyStore: text("key_store", { enum: ["keychain", "file"] }).notNull(),
		createdAt: createdAt(),
		/** When the Host refused the key: its owner removed this computer's access. */
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		uniqueIndex("host_link_home_idx")
			.on(table.role)
			.where(sql`${table.role} = 'home'`),
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
		/** The one Space the project is in. Its Clones, runs and events are in it too. */
		spaceId: spaceId(),
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
	(table) => [
		uniqueIndex("project_remote_idx").on(table.remote),
		index("project_spaceId_idx").on(table.spaceId),
	],
);

/** A Project's repository on one Device, at a path. Owned by that Device. */
export const clone = sqliteTable(
	"clone",
	{
		id: text("id").primaryKey(),
		spaceId: spaceId(),
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
		/** The project's Space. */
		spaceId: spaceId(),
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
	(table) => [
		index("run_projectId_idx").on(table.projectId),
		index("run_spaceId_idx").on(table.spaceId),
	],
);

/** One visit of one node. */
export const step = sqliteTable(
	"step",
	{
		id: text("id").primaryKey(),
		spaceId: spaceId(),
		runId: text("run_id")
			.notNull()
			.references(() => run.id),
		nodeId: text("node_id").notNull(),
		nodeType: text("node_type").notNull(),
		/** 1 for the first visit of this node in the run. */
		visit: integer("visit").notNull(),
		/** Absolute path of the step's NDJSON transcript on disk. */
		transcriptPath: text("transcript_path").notNull(),
		/** The Device the step's body ran on (its Placement): this computer, until steps are placed. */
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
		spaceId: spaceId(),
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
		/** The Space of the event's run, or of its project for a fact of no run. */
		spaceId: spaceId(),
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
		index("event_spaceId_idx").on(table.spaceId),
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
 * A Yjs document, by name, as its full state (`Y.encodeStateAsUpdate`).
 * The Device document of this computer is `device:<id>`: its Agent
 * Profiles, CLI Tools, Connections, settings and facts. Its Owner (this
 * computer for its own document) writes the row after every change.
 */
export const ydoc = sqliteTable("ydoc", {
	name: text("name").primaryKey(),
	state: blob("state", { mode: "buffer" }).notNull(),
	updatedAt: updatedAt(),
});

/**
 * How far this Replica has exchanged run history with one Host, per Space
 * and Walker: the last `walker_seq` it has. For another Walker, the last of
 * its events this Replica pulled from that Host. For this computer, the
 * last of its own events that Host took (a push). A Space starts at 0, so
 * a Space this Device's owner joins later is exchanged from its start.
 */
export const syncCursor = sqliteTable(
	"sync_cursor",
	{
		hostId: text("host_id").notNull(),
		spaceId: text("space_id").notNull(),
		walkerId: text("walker_id").notNull(),
		walkerSeq: integer("walker_seq").notNull(),
		updatedAt: updatedAt(),
	},
	(table) => [
		primaryKey({ columns: [table.hostId, table.spaceId, table.walkerId] }),
	],
);

/**
 * A Space this computer takes part in through a Host: the Host keeps it,
 * this Replica keeps a copy (its Space document, its runs). Its owner's
 * role there comes with the Host's answer to the link; the Replica also
 * gets an `organization` row and a `member` row for its own Person with
 * that role, so sessions and permission checks work here unchanged.
 */
export const hostSpace = sqliteTable("host_space", {
	spaceId: text("space_id").primaryKey(),
	/** The Host's Device id. */
	hostId: text("host_id").notNull(),
	name: text("name").notNull(),
	/** The role of this Device's owner in the Space, on the Host. */
	role: text("role").notNull(),
	/** The Space is the personal Space of this Device's owner on the Host. */
	personal: integer("personal", { mode: "boolean" }).notNull().default(false),
	updatedAt: updatedAt(),
});

/**
 * A person's action on a run that another Device walks, on its way to the
 * Walker: answer a Gate, send a signal, stop. The Walker is the only writer
 * of its run's events, so the Host keeps the command until the Walker has
 * applied it (`done_at`), with the Walker's reason when it refused.
 */
export const runCommand = sqliteTable(
	"run_command",
	{
		id: text("id").primaryKey(),
		spaceId: spaceId(),
		runId: text("run_id").notNull(),
		/** The Device that walks the run and applies the command. */
		walkerId: text("walker_id").notNull(),
		kind: text("kind", {
			enum: ["gate.resolve", "signal.send", "run.stop"],
		}).notNull(),
		/** JSON: the action's input (the Gate's step, choice and note; the signal; when to stop). */
		payload: text("payload").notNull(),
		/** The Person who asked, on the Host. The Walker checks their role again. */
		personId: text("person_id").notNull(),
		createdAt: createdAt(),
		doneAt: integer("done_at", { mode: "timestamp_ms" }),
		/** Why the Walker did not apply it. Null when it did. */
		error: text("error"),
	},
	(table) => [
		index("run_command_walkerId_idx").on(table.walkerId),
		index("run_command_runId_idx").on(table.runId),
	],
);

/*
 * Read-only since the Device document: `setting`, `connection`, `cli_tool`,
 * `agent_profile` and `secret` are imported into it once, on the first
 * start of the version that added `ydoc`, and never written again. SQL
 * cannot write a Yjs document, so a migration cannot move the rows itself:
 * a later migration drops these tables, once every install has started
 * this version.
 */

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
