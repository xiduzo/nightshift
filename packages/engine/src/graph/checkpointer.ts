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
import type { Client, InValue, Row } from "@libsql/client";
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
		await this.client.execute({
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
		});
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
	 * Keeps the thread's latest root checkpoint (with its pending writes) and
	 * deletes every other checkpoint and write of the thread: the older root
	 * ones and every subgraph namespace. The thread stays re-enterable from
	 * its final state; its history goes.
	 */
	async pruneThread(threadId: string): Promise<void> {
		const latest = `(SELECT MAX(checkpoint_id) FROM lg_checkpoint
        WHERE thread_id = ? AND checkpoint_ns = '')`;
		const keep = `checkpoint_ns = '' AND checkpoint_id = ${latest}`;
		await this.client.batch(
			[
				{
					sql: `DELETE FROM lg_checkpoint WHERE thread_id = ? AND NOT (${keep})`,
					args: [threadId, threadId],
				},
				{
					sql: `DELETE FROM lg_write WHERE thread_id = ? AND NOT (${keep})`,
					args: [threadId, threadId],
				},
			],
			"write",
		);
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

/** A BLOB column as bytes, whichever shape the driver returns. */
function blob(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (typeof value === "string") return new TextEncoder().encode(value);
	throw new Error(`Unexpected BLOB value of type ${typeof value}`);
}
