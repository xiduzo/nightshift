import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { createdAt, spaceId, updatedAt } from "./columns";
import { project } from "./projects";

// Owner: `@nightshift/engine`: `log/` appends the event log and writes the
// run and step rows, `run/` starts and recovers runs, `graph/` adds steps
// and Agent sessions while a run walks, and `read/` reads them all.
// `log/history.ts` reads and adds the rows that `@nightshift/devices`
// `exchange/` copies between Replicas by cursor, and the files of own steps
// that its archive keeps.
//
// Durable facts only. Status is derived from the event log, never stored.

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
		/**
		 * The Device the run's steps run on and its worktree lives on (its
		 * Placement): the Walker, or another Device of the Person who
		 * started it. Null for runs from before Placement: the Walker. No
		 * foreign key, like `walker_id`.
		 */
		deviceId: text("device_id"),
		/**
		 * JSON: the Devices the run's nodes name (their `device`), by name:
		 * `{ "hetzner-1": "<device id>" }`, resolved when the run started. A
		 * node without one runs on `device_id`. Null: no node names one.
		 */
		placements: text("placements"),
		/**
		 * JSON: the names of the Devices of `device_id` and `placements`, by
		 * id, as run start knew them: `{ "<device id>": "hetzner-1" }`. With
		 * those two and `started_by` it is the run's plan, which the walk
		 * reads. Null: a run from before the plan, or from a Device of a
		 * version before it.
		 */
		deviceNames: text("device_names"),
		/**
		 * The Person who started the run: for a schedule, its Person, else
		 * the owner of the Device that fired it. Null only for a run another
		 * Replica walked before every run had a starter. No foreign key: a
		 * run walked elsewhere may name a Person this Replica does not know.
		 */
		startedBy: text("started_by"),
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
		// The exchange reads a Walker's run events in a Space after a cursor,
		// and the landed feed the latest of each at start: both from here.
		index("event_run_spaceId_walkerId_walkerSeq_idx")
			.on(table.spaceId, table.walkerId, table.walkerSeq)
			.where(sql`${table.runId} is not null`),
	],
);

// Owner: `@nightshift/engine` `variables/`: `graph/` saves a kept value with
// the step that writes it, and `run/` reads and resets them for a person.

/**
 * The value a kept variable (`keep: "project"`) has between runs: one per
 * project, flow and variable. A run of the flow starts from it, and each
 * write of the variable saves it in the batch of its `StepEnded`, so the
 * last write wins. A run's own history stays in its events: this row is
 * only the value the next run starts from. Kept on the Replica that walks
 * the runs; the exchange does not copy it. A reset removes the row.
 */
export const keptVariable = sqliteTable(
	"kept_variable",
	{
		spaceId: spaceId(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id),
		/** The flow file's name; a called flow keeps its own. */
		flowName: text("flow_name").notNull(),
		name: text("name").notNull(),
		/** JSON-encoded value. */
		value: text("value").notNull(),
		/** The run and step that wrote it last. No foreign keys, like the event log. */
		runId: text("run_id").notNull(),
		stepId: text("step_id").notNull(),
		updatedAt: updatedAt(),
	},
	(table) => [
		primaryKey({ columns: [table.projectId, table.flowName, table.name] }),
		index("kept_variable_spaceId_idx").on(table.spaceId),
	],
);
