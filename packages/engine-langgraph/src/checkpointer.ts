/**
 * SPIKE. A LangGraph checkpoint saver on `@libsql/client`, so a graph's
 * checkpoints live in Night Shift's own database (Bun cannot load the
 * official `@langchain/langgraph-checkpoint-sqlite`, which needs
 * better-sqlite3). A port of that package's SqliteSaver to an async client.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import {
	BaseCheckpointSaver,
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
    FROM lg_writes AS pw
    WHERE pw.thread_id = lg_checkpoints.thread_id
      AND pw.checkpoint_ns = lg_checkpoints.checkpoint_ns
      AND pw.checkpoint_id = lg_checkpoints.checkpoint_id
  ) AS pending_writes
FROM lg_checkpoints`;

export class LibsqlSaver extends BaseCheckpointSaver {
	private ready: Promise<void> | null = null;

	constructor(
		private readonly client: Client,
		serde?: SerializerProtocol,
	) {
		super(serde);
	}

	private setup(): Promise<void> {
		this.ready ??= (async () => {
			await this.client.executeMultiple(`
CREATE TABLE IF NOT EXISTS lg_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS lg_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_path TEXT NOT NULL DEFAULT '',
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);`);
		})();
		return this.ready;
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
		await this.setup();
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
		await this.setup();
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
			where.push("json_extract(CAST(metadata AS TEXT), ?) = json(?)");
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
	): Promise<RunnableConfig> {
		await this.setup();
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
			sql: `INSERT OR REPLACE INTO lg_checkpoints
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
		await this.setup();
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
					sql: `INSERT ${allSpecial ? "OR REPLACE" : "OR IGNORE"} INTO lg_writes
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

	async deleteThread(threadId: string): Promise<void> {
		await this.setup();
		await this.client.batch(
			[
				{
					sql: "DELETE FROM lg_checkpoints WHERE thread_id = ?",
					args: [threadId],
				},
				{ sql: "DELETE FROM lg_writes WHERE thread_id = ?", args: [threadId] },
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
