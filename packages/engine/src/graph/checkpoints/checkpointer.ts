/**
 * A LangGraph checkpoint saver on `@libsql/client`, so a run's checkpoints
 * live in Night Shift's own database next to its events. A port of
 * `@langchain/langgraph-checkpoint-sqlite`'s SqliteSaver to an async client
 * (Bun cannot load the official one, which needs better-sqlite3).
 *
 * The tables `lg_checkpoint` and `lg_write` are drizzle schema
 * (`@nightshift/db/schema`, in `engine.ts`) and a migration owns them; the
 * saver never creates them.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import {
	BaseCheckpointSaver,
	type ChannelVersions,
	type Checkpoint,
	type CheckpointListOptions,
	type CheckpointMetadata,
	type CheckpointTuple,
	compareWritesSortKeys,
	copyCheckpoint,
	type PendingWrite,
	type SerializerProtocol,
	WRITES_IDX_MAP,
	writesSortKey,
} from "@langchain/langgraph-checkpoint";
import type { Client, InStatement, InValue, Row } from "@libsql/client";
import type { Database } from "@nightshift/db";

type WriteColumn = {
	task_id: string;
	channel: string;
	type: string | null;
	value: string | null;
	task_path: string | null;
	idx: number | null;
};

function sortWrites(columns: WriteColumn[]): WriteColumn[] {
	return columns
		.map((column) => ({
			key: writesSortKey(
				column.task_path ?? "",
				column.task_id,
				column.idx ?? 0,
			),
			column,
		}))
		.sort((a, b) => compareWritesSortKeys(a.key, b.key))
		.map(({ column }) => column);
}

const SELECT = `
SELECT
  thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata,
  (
    SELECT json_group_array(json_object(
      'task_id', pw.task_id, 'channel', pw.channel, 'type', pw.type,
      'value', CAST(pw.value AS TEXT), 'task_path', pw.task_path, 'idx', pw.idx))
    FROM lg_write AS pw
    WHERE pw.thread_id = lg_checkpoint.thread_id
      AND pw.checkpoint_ns = lg_checkpoint.checkpoint_ns
      AND pw.checkpoint_id = lg_checkpoint.checkpoint_id
  ) AS pending_writes
FROM lg_checkpoint`;

/** The saver over the engine's database: drizzle exposes its libsql client as `db.$client`. */
export function saverFor(db: Database): LibsqlSaver {
	return new LibsqlSaver(db.$client);
}

/**
 * Prunes every run's thread to what a resume reads (`pruneAll`): startup
 * recovery's sweep, which also cleans a database from before the saver
 * kept only the latest checkpoint.
 */
export function pruneCheckpoints(db: Database): Promise<void> {
	return saverFor(db).pruneAll();
}

export class LibsqlSaver extends BaseCheckpointSaver {
	constructor(
		private readonly client: Client,
		serde?: SerializerProtocol,
	) {
		super(serde);
	}

	private async toTuple(row: Row): Promise<CheckpointTuple> {
		const threadId = String(row.thread_id);
		const ns = String(row.checkpoint_ns ?? "");
		const writes = JSON.parse(String(row.pending_writes)) as WriteColumn[];
		const pendingWrites = await Promise.all(
			sortWrites(writes).map(
				async (write) =>
					[
						write.task_id,
						write.channel,
						await this.serde.loadsTyped(
							write.type ?? "json",
							write.value ?? "",
						),
					] as [string, string, unknown],
			),
		);
		const parent = row.parent_checkpoint_id
			? String(row.parent_checkpoint_id)
			: null;
		return {
			config: {
				configurable: {
					thread_id: threadId,
					checkpoint_ns: ns,
					checkpoint_id: String(row.checkpoint_id),
				},
			},
			checkpoint: (await this.serde.loadsTyped(
				String(row.type ?? "json"),
				blob(row.checkpoint),
			)) as Checkpoint,
			metadata: (await this.serde.loadsTyped(
				String(row.type ?? "json"),
				blob(row.metadata),
			)) as CheckpointMetadata,
			parentConfig: parent
				? {
						configurable: {
							thread_id: threadId,
							checkpoint_ns: ns,
							checkpoint_id: parent,
						},
					}
				: undefined,
			pendingWrites,
		};
	}

	async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
		const {
			thread_id,
			checkpoint_ns = "",
			checkpoint_id,
		} = config.configurable ?? {};
		const sql = checkpoint_id
			? `${SELECT} WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
			: `${SELECT} WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1`;
		const args: InValue[] = [thread_id, checkpoint_ns];
		if (checkpoint_id) args.push(checkpoint_id);
		const { rows } = await this.client.execute({ sql, args });
		const row = rows[0];
		return row ? this.toTuple(row) : undefined;
	}

	async *list(
		config: RunnableConfig,
		options?: CheckpointListOptions,
	): AsyncGenerator<CheckpointTuple> {
		const where: string[] = [];
		const args: InValue[] = [];
		const threadId = config.configurable?.thread_id;
		const ns = config.configurable?.checkpoint_ns;
		if (threadId) {
			where.push("thread_id = ?");
			args.push(threadId);
		}
		if (ns !== undefined && ns !== null) {
			where.push("checkpoint_ns = ?");
			args.push(ns);
		}
		const before = options?.before?.configurable?.checkpoint_id;
		if (before !== undefined) {
			where.push("checkpoint_id < ?");
			args.push(before);
		}
		for (const [key, value] of Object.entries(options?.filter ?? {})) {
			if (value === undefined) continue;
			// `->` gives the JSON text of the value, so it compares with JSON.stringify.
			where.push("CAST(metadata AS TEXT) -> ? = ?");
			args.push(`$.${key}`, JSON.stringify(value));
		}
		let sql = SELECT;
		if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
		sql += " ORDER BY checkpoint_id DESC";
		if (options?.limit) sql += ` LIMIT ${Number(options.limit)}`;
		const { rows } = await this.client.execute({ sql, args });
		for (const row of rows) yield this.toTuple(row);
	}

	async put(
		config: RunnableConfig,
		checkpoint: Checkpoint,
		metadata: CheckpointMetadata,
		// The new channel versions are inside the checkpoint; this saver stores it whole.
		_newVersions?: ChannelVersions,
	): Promise<RunnableConfig> {
		const threadId = config.configurable?.thread_id;
		if (!threadId) throw new Error("Missing thread_id in config.configurable.");
		const ns = config.configurable?.checkpoint_ns ?? "";
		const parent = config.configurable?.checkpoint_id ?? null;
		const [[type1, serializedCheckpoint], [type2, serializedMetadata]] =
			await Promise.all([
				this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
				this.serde.dumpsTyped(metadata),
			]);
		if (type1 !== type2) {
			throw new Error("Checkpoint and metadata serialized to different types.");
		}
		// The new checkpoint replaces the older ones of its namespace, and
		// the namespaces below it that hang from an older one go (`pruneThread`
		// says why that is safe).
		await this.client.batch(
			[
				{
					sql: `INSERT OR REPLACE INTO lg_checkpoint
        (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
					args: [
						threadId,
						ns,
						checkpoint.id,
						parent,
						type1,
						serializedCheckpoint,
						serializedMetadata,
					],
				},
				...olderThan(threadId, ns, checkpoint.id),
			],
			"write",
		);
		return {
			configurable: {
				thread_id: threadId,
				checkpoint_ns: ns,
				checkpoint_id: checkpoint.id,
			},
		};
	}

	async putWrites(
		config: RunnableConfig,
		writes: PendingWrite[],
		taskId: string,
		taskPath = "",
	): Promise<void> {
		const threadId = config.configurable?.thread_id;
		const checkpointId = config.configurable?.checkpoint_id;
		if (!threadId || !checkpointId) {
			throw new Error(
				"Missing thread_id or checkpoint_id in config.configurable.",
			);
		}
		const allSpecial = writes.every(([channel]) => channel in WRITES_IDX_MAP);
		const statements = await Promise.all(
			writes.map(async ([channel, value], idx) => {
				const [type, serialized] = await this.serde.dumpsTyped(value);
				return {
					sql: `INSERT ${allSpecial ? "OR REPLACE" : "OR IGNORE"} INTO lg_write
            (thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, type, value)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					args: [
						threadId,
						config.configurable?.checkpoint_ns ?? "",
						checkpointId,
						taskId,
						taskPath,
						WRITES_IDX_MAP[channel] ?? idx,
						channel,
						type,
						serialized,
					] as InValue[],
				};
			}),
		);
		if (statements.length > 0) await this.client.batch(statements, "write");
	}

	/**
	 * Keeps what a resume of the thread reads and deletes the rest: the
	 * latest checkpoint of each namespace that LangGraph can still enter,
	 * with its pending writes. Safe while a drive writes to the thread.
	 *
	 * LangGraph reads only the latest checkpoint of a namespace (no
	 * checkpoint id is asked for: Night Shift has no time travel and no
	 * history) and the writes of that checkpoint. A namespace below the
	 * root is `<parent>|<node>:<task id>` (LangGraph adds `|<n>` for a
	 * second subgraph of one task), and the task id comes from the parent's
	 * checkpoint id. So a namespace is never entered again once its parent
	 * has a newer checkpoint (its metadata names the parent's checkpoint it
	 * began under), once its task's writes are saved (the task is done and
	 * does not run again), or once its parent is gone. Those go whole, and
	 * so do the older checkpoints and writes of every namespace that stays.
	 *
	 * Delta channels would need the older checkpoints. The run state has
	 * none (`state.ts`).
	 */
	async pruneThread(threadId: string): Promise<void> {
		const [heads, done] = await this.client.batch(
			[
				{
					sql: `SELECT checkpoint_ns, checkpoint_id, type, metadata FROM lg_checkpoint AS h
            WHERE h.thread_id = ? AND h.checkpoint_id = ${latestOf("h")}`,
					args: [threadId, threadId],
				},
				{
					sql: `SELECT checkpoint_ns, checkpoint_id, task_id FROM lg_write AS w
            WHERE w.thread_id = ? AND w.channel NOT IN (${UNFINISHED.map(() => "?").join(", ")})
              AND w.checkpoint_id = ${latestOf("w")}`,
					args: [threadId, ...UNFINISHED, threadId],
				},
			],
			"read",
		);
		const namespaces = new Map<string, Head>();
		for (const row of heads?.rows ?? []) {
			const metadata = (await this.serde.loadsTyped(
				String(row.type ?? "json"),
				blob(row.metadata),
			)) as CheckpointMetadata | undefined;
			namespaces.set(String(row.checkpoint_ns ?? ""), {
				id: String(row.checkpoint_id),
				parents: metadata?.parents ?? {},
			});
		}
		const finished = new Set(
			(done?.rows ?? []).map((row) =>
				key(
					String(row.checkpoint_ns ?? ""),
					String(row.checkpoint_id),
					String(row.task_id),
				),
			),
		);
		const gone = [...namespaces.keys()].filter((ns) =>
			isGone(ns, namespaces, finished),
		);
		const inGone = gone.map(() => "?").join(", ");
		await this.client.batch(
			[
				...(gone.length > 0
					? ["lg_write", "lg_checkpoint"].map((table) => ({
							sql: `DELETE FROM ${table} WHERE thread_id = ? AND checkpoint_ns IN (${inGone})`,
							args: [threadId, ...gone],
						}))
					: []),
				// Writes of an older checkpoint, or of a namespace with none.
				{
					sql: `DELETE FROM lg_write WHERE thread_id = ? AND (checkpoint_id < ${latestOf("lg_write")}
            OR NOT EXISTS (SELECT 1 FROM lg_checkpoint AS c
              WHERE c.thread_id = lg_write.thread_id AND c.checkpoint_ns = lg_write.checkpoint_ns))`,
					args: [threadId, threadId],
				},
				{
					sql: `DELETE FROM lg_checkpoint WHERE thread_id = ? AND checkpoint_id < ${latestOf("lg_checkpoint")}`,
					args: [threadId, threadId],
				},
			],
			"write",
		);
	}

	/**
	 * Prunes every thread with more than it needs (`pruneThread`): the
	 * one-off cleanup of a database from before the saver kept only the
	 * latest checkpoint. Idempotent, and cheap: it reads no thread that holds
	 * one checkpoint and no stray write.
	 */
	async pruneAll(): Promise<void> {
		const { rows } = await this.client.execute(`
      SELECT thread_id FROM lg_checkpoint GROUP BY thread_id HAVING count(*) > 1
      UNION
      SELECT w.thread_id FROM lg_write AS w WHERE NOT EXISTS (SELECT 1 FROM lg_checkpoint AS c
        WHERE c.thread_id = w.thread_id AND c.checkpoint_ns = w.checkpoint_ns
          AND c.checkpoint_id = w.checkpoint_id)`);
		for (const row of rows) await this.pruneThread(String(row.thread_id));
	}

	async deleteThread(threadId: string): Promise<void> {
		await this.client.batch(
			[
				{
					sql: "DELETE FROM lg_checkpoint WHERE thread_id = ?",
					args: [threadId],
				},
				{ sql: "DELETE FROM lg_write WHERE thread_id = ?", args: [threadId] },
			],
			"write",
		);
	}
}

/** The id of the latest checkpoint in the namespace of the row `alias` (one `?`: the thread id). */
const latestOf = (
	alias: string,
) => `(SELECT MAX(c.checkpoint_id) FROM lg_checkpoint AS c
  WHERE c.thread_id = ? AND c.checkpoint_ns = ${alias}.checkpoint_ns)`;

/**
 * The channels of a write that does not finish its task: a failed or
 * interrupted task runs again (LangGraph's `_reapplyWritesToSucceededNodes`).
 */
const UNFINISHED = [
	"__error__",
	"__error_source_node__",
	"__interrupt__",
	"__resume__",
];

/** A namespace's latest checkpoint, and the checkpoints of the namespaces above it that it began under. */
type Head = { id: string; parents: Record<string, string> };

const key = (ns: string, checkpointId: string, taskId: string) =>
	`${ns}\u0000${checkpointId}\u0000${taskId}`;

/**
 * The namespace above `ns` and the id of the task that entered it, or null
 * for the root. `|<n>` parts (a task's second subgraph) belong to the task.
 */
function taskOf(ns: string): { parent: string; taskId: string } | null {
	const parts = ns.split("|");
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i] as string;
		const colon = part.lastIndexOf(":");
		if (colon === -1) continue;
		return {
			parent: parts.slice(0, i).join("|"),
			taskId: part.slice(colon + 1),
		};
	}
	return null;
}

/** Whether LangGraph can never enter `ns` again (`pruneThread`). */
function isGone(
	ns: string,
	namespaces: ReadonlyMap<string, Head>,
	finished: ReadonlySet<string>,
): boolean {
	const task = taskOf(ns);
	if (!task) return false;
	const parent = namespaces.get(task.parent);
	if (!parent) return true;
	const beganUnder = namespaces.get(ns)?.parents[task.parent];
	if (beganUnder !== undefined && beganUnder !== parent.id) return true;
	if (finished.has(key(task.parent, parent.id, task.taskId))) return true;
	return isGone(task.parent, namespaces, finished);
}

/**
 * Deletes what a new checkpoint `checkpointId` in `ns` makes useless: the
 * older checkpoints and writes of `ns`, and every namespace below it that
 * began under an older checkpoint of `ns`. Its task ids came from that
 * checkpoint, so LangGraph never enters it again. A namespace whose name
 * JSON cannot address is left to `pruneThread`.
 */
function olderThan(
	threadId: string,
	ns: string,
	checkpointId: string,
): InStatement[] {
	const statements: InStatement[] = ["lg_write", "lg_checkpoint"].map(
		(table) => ({
			sql: `DELETE FROM ${table} WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id < ?`,
			args: [threadId, ns, checkpointId],
		}),
	);
	if (/["\\]/.test(ns)) return statements;
	const below = `thread_id = ? AND checkpoint_ns <> ? AND (CASE
      WHEN type = 'json' AND json_valid(CAST(metadata AS TEXT))
      THEN json_extract(CAST(metadata AS TEXT), ?) END) < ?`;
	const args = [threadId, ns, `$.parents."${ns}"`, checkpointId];
	statements.push(
		{
			sql: `DELETE FROM lg_write WHERE thread_id = ? AND checkpoint_ns IN
        (SELECT checkpoint_ns FROM lg_checkpoint WHERE ${below})`,
			args: [threadId, ...args],
		},
		{ sql: `DELETE FROM lg_checkpoint WHERE ${below}`, args },
	);
	return statements;
}

/** A BLOB column as bytes, whichever shape the driver returns. */
function blob(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (typeof value === "string") return new TextEncoder().encode(value);
	throw new Error(`Unexpected BLOB value of type ${typeof value}`);
}
