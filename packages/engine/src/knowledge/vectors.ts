import type { Database } from "bun:sqlite";
import { Document, type DocumentInterface } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type {
	ListKeyOptions,
	RecordManagerInterface,
	UpdateOptions,
} from "@langchain/core/indexing";
import { VectorStore } from "@langchain/core/vectorstores";

/**
 * The two pieces that `index()` from `@langchain/core/indexing` needs to
 * keep the knowledge's vectors current, on the search index's own
 * bun:sqlite file: a record manager and a vector store.
 *
 * LangChain has both, but not for Bun (`docs/research/knowledge-vectors.md`
 * §2.3): its `SQLiteRecordManager` loads `better-sqlite3`, a native addon
 * that crashes Bun on load and does not go into `bun build --compile`, and
 * its `LibSQLVectorStore` ignores the ids `index()` gives it, so old
 * sections are never deleted. These small classes implement the same
 * LangChain interfaces on bun:sqlite instead.
 *
 * The vectors are float32 BLOBs, searched by an exact scan in JS: no
 * extension and no native addon. It stays fast for a project's knowledge
 * (about 50 ms over 20 000 sections of 1 024 dimensions).
 */

/** The record manager's table: which section ids `index()` stored, and when. */
function recordsSchema(db: Database): void {
	db.run(
		"CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, key TEXT NOT NULL, updated_at REAL NOT NULL, group_id TEXT, PRIMARY KEY (namespace, key))",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS records_time ON records (namespace, updated_at)",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS records_group ON records (namespace, group_id)",
	);
}

/** The vector store's table: one row per section of a project, by its id. */
function vectorsSchema(db: Database): void {
	db.run(
		"CREATE TABLE IF NOT EXISTS vectors (project_id TEXT NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (project_id, id))",
	);
}

/** Creates the tables of both classes in `db`, when they are not there. */
export function createVectorTables(db: Database): void {
	recordsSchema(db);
	vectorsSchema(db);
}

/** The tables of both classes, for an index built again. */
export const VECTOR_TABLES = ["records", "vectors"] as const;

/**
 * A LangChain record manager on bun:sqlite, one namespace per project.
 *
 * Its clock strictly increases. `index()` deletes the records of a
 * source that are older than the time it started, so two runs in one
 * tick of the clock must not share a time: then the old sections stay.
 * LangChain's `SQLiteRecordManager` counts in whole seconds and has that
 * bug.
 */
export class BunSqliteRecordManager implements RecordManagerInterface {
	lc_namespace = ["nightshift", "knowledge", "recordmanagers"];
	private last: number | null = null;

	constructor(
		private readonly db: Database,
		private readonly namespace: string,
	) {}

	async createSchema(): Promise<void> {
		recordsSchema(this.db);
	}

	async getTime(): Promise<number> {
		if (this.last === null) {
			// After a restart too: never before a time already written.
			const row = this.db
				.query<{ at: number | null }, [string]>(
					"SELECT max(updated_at) AS at FROM records WHERE namespace = ?",
				)
				.get(this.namespace);
			this.last = row?.at ?? 0;
		}
		this.last = Math.max(Date.now() / 1000, this.last + 1e-6);
		return this.last;
	}

	async update(keys: string[], options: UpdateOptions = {}): Promise<void> {
		const { groupIds, timeAtLeast } = options;
		if (groupIds && groupIds.length !== keys.length) {
			throw new Error("Each key needs its group id.");
		}
		const now = await this.getTime();
		if (timeAtLeast !== undefined && now < timeAtLeast) {
			throw new Error(`The clock went back: ${now} < ${timeAtLeast}.`);
		}
		// Without group ids, a key keeps the group it had.
		const put = this.db.prepare(
			"INSERT INTO records (namespace, key, updated_at, group_id) VALUES (?, ?, ?, ?) ON CONFLICT (namespace, key) DO UPDATE SET updated_at = excluded.updated_at, group_id = coalesce(excluded.group_id, records.group_id)",
		);
		this.db.transaction(() => {
			for (const [i, key] of keys.entries()) {
				put.run(this.namespace, key, now, groupIds?.[i] ?? null);
			}
		})();
	}

	async exists(keys: string[]): Promise<boolean[]> {
		const has = this.db.prepare<{ one: number }, [string, string]>(
			"SELECT 1 AS one FROM records WHERE namespace = ? AND key = ?",
		);
		return keys.map((key) => has.get(this.namespace, key) !== null);
	}

	async listKeys(options: ListKeyOptions = {}): Promise<string[]> {
		let sql = "SELECT key FROM records WHERE namespace = ?";
		const args: (string | number)[] = [this.namespace];
		if (options.before !== undefined) {
			sql += " AND updated_at < ?";
			args.push(options.before);
		}
		if (options.after !== undefined) {
			sql += " AND updated_at > ?";
			args.push(options.after);
		}
		if (options.groupIds) {
			const groups = options.groupIds.filter(
				(group): group is string => group !== null,
			);
			const nulls = groups.length < options.groupIds.length;
			const any = groups.map(() => "?").join(", ");
			const parts = [
				...(groups.length > 0 ? [`group_id IN (${any})`] : []),
				...(nulls ? ["group_id IS NULL"] : []),
			];
			sql += parts.length > 0 ? ` AND (${parts.join(" OR ")})` : " AND 0";
			args.push(...groups);
		}
		if (options.limit !== undefined) {
			sql += " LIMIT ?";
			args.push(options.limit);
		}
		return this.db
			.query<{ key: string }, (string | number)[]>(sql)
			.all(...args)
			.map((row) => row.key);
	}

	async deleteKeys(keys: string[]): Promise<void> {
		const drop = this.db.prepare(
			"DELETE FROM records WHERE namespace = ? AND key = ?",
		);
		this.db.transaction(() => {
			for (const key of keys) drop.run(this.namespace, key);
		})();
	}
}

/** The vectors of a project in memory, each scaled to length 1. */
type Matrix = {
	dim: number;
	data: Float32Array;
	rows: { id: string; text: string; metadata: string }[];
};

/**
 * A LangChain vector store on bun:sqlite, for one project. It keeps the
 * ids `index()` gives it and deletes by them. A search scans every vector
 * of the project by cosine similarity. The project's vectors stay in
 * memory between searches, until a change.
 */
export class BunSqliteVectorStore extends VectorStore {
	declare FilterType: (doc: DocumentInterface) => boolean;
	private matrix: Matrix | null = null;

	constructor(
		embeddings: EmbeddingsInterface,
		private readonly db: Database,
		private readonly projectId: string,
	) {
		super(embeddings, {});
		vectorsSchema(db);
	}

	_vectorstoreType(): string {
		return "nightshift-bun-sqlite";
	}

	async addDocuments(
		documents: DocumentInterface[],
		options?: { ids?: string[] },
	): Promise<string[]> {
		const vectors = await this.embeddings.embedDocuments(
			documents.map((document) => document.pageContent),
		);
		return this.addVectors(vectors, documents, options);
	}

	async addVectors(
		vectors: number[][],
		documents: DocumentInterface[],
		options?: { ids?: string[] },
	): Promise<string[]> {
		const ids = documents.map(
			(document, i) => options?.ids?.[i] ?? document.id ?? crypto.randomUUID(),
		);
		const put = this.db.prepare(
			"INSERT OR REPLACE INTO vectors (project_id, id, text, metadata, vec) VALUES (?, ?, ?, ?, ?)",
		);
		this.db.transaction(() => {
			for (const [i, document] of documents.entries()) {
				const vector = vectors[i];
				if (!vector) throw new Error("Each document needs its vector.");
				put.run(
					this.projectId,
					ids[i] as string,
					document.pageContent,
					JSON.stringify(document.metadata ?? {}),
					new Uint8Array(new Float32Array(vector).buffer),
				);
			}
		})();
		this.matrix = null;
		return ids;
	}

	async delete(params?: { ids?: string[] }): Promise<void> {
		const ids = params?.ids ?? [];
		const drop = this.db.prepare(
			"DELETE FROM vectors WHERE project_id = ? AND id = ?",
		);
		this.db.transaction(() => {
			for (const id of ids) drop.run(this.projectId, id);
		})();
		this.matrix = null;
	}

	/** How many sections of the project have a vector. */
	count(): number {
		return (
			this.db
				.query<{ n: number }, [string]>(
					"SELECT count(*) AS n FROM vectors WHERE project_id = ?",
				)
				.get(this.projectId)?.n ?? 0
		);
	}

	private load(): Matrix {
		if (this.matrix) return this.matrix;
		const rows = this.db
			.query<
				{ id: string; text: string; metadata: string; vec: Uint8Array },
				[string]
			>(
				"SELECT id, text, metadata, vec FROM vectors WHERE project_id = ? ORDER BY id",
			)
			.all(this.projectId);
		const dim = rows[0] ? rows[0].vec.byteLength / 4 : 0;
		// A row of another length is from another model: it is left out.
		const kept = rows.filter((row) => row.vec.byteLength === dim * 4);
		const data = new Float32Array(kept.length * dim);
		for (const [i, row] of kept.entries()) {
			const vector = new Float32Array(row.vec.slice().buffer);
			let norm = 0;
			for (const x of vector) norm += x * x;
			norm = Math.sqrt(norm) || 1;
			for (let d = 0; d < dim; d++) {
				data[i * dim + d] = (vector[d] as number) / norm;
			}
		}
		this.matrix = {
			dim,
			data,
			rows: kept.map(({ id, text, metadata }) => ({ id, text, metadata })),
		};
		return this.matrix;
	}

	async similaritySearchVectorWithScore(
		query: number[],
		k: number,
		filter?: this["FilterType"],
	): Promise<[DocumentInterface, number][]> {
		const { dim, data, rows } = this.load();
		if (rows.length === 0 || query.length !== dim) return [];
		let norm = 0;
		for (const x of query) norm += x * x;
		norm = Math.sqrt(norm) || 1;
		const scored: { i: number; score: number }[] = [];
		for (let i = 0; i < rows.length; i++) {
			let dot = 0;
			const at = i * dim;
			for (let d = 0; d < dim; d++) {
				dot += (data[at + d] as number) * (query[d] as number);
			}
			scored.push({ i, score: dot / norm });
		}
		scored.sort((a, b) => b.score - a.score);
		const out: [DocumentInterface, number][] = [];
		for (const { i, score } of scored) {
			if (out.length >= k) break;
			const row = rows[i];
			if (!row) continue;
			const document = new Document({
				id: row.id,
				pageContent: row.text,
				metadata: JSON.parse(row.metadata) as Record<string, unknown>,
			});
			if (filter && !filter(document)) continue;
			out.push([document, score]);
		}
		return out;
	}
}
