import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Document } from "@langchain/core/documents";
import { KNOWLEDGE_SEARCH_FILE } from "@nightshift/flows";
import type { KnowledgeFile } from "./folder-snapshot";
import type { KnowledgeMeaning } from "./meaning";
import { type SectionMetadata, sectionId } from "./sections";
import { BunSqliteRecordManager, BunSqliteVectorStore } from "./vectors";

/**
 * The search index on disk: `<dataDir>/knowledge/.search.sqlite`, and the
 * one module that knows its tables. It holds all the DDL and
 * `SCHEMA_VERSION`, the vector tables included, so a change of a table
 * cannot forget the bump. The file is a rebuildable cache: a version that
 * differs, or a file that does not open, builds a new one.
 *
 * Whatever needs the tables crosses this interface: the refresh writes files
 * and sections, the query reads them, and the vector preparation reads
 * sections and gets the vector store and record manager of a project.
 */

/** Bump to build every index again: a new table needs no bump, since each open creates it. 2: PDF and Word files. 3: their text through LangChain loaders. 4: sections, and vectors by meaning. 5: a section's stable id, on its row and in its vector's metadata, and its heading path, which the model reads. */
const SCHEMA_VERSION = 5;
/** Every table of the index, for an index built again. */
const TABLES = [
	"files",
	"texts",
	"sections",
	"meta",
	"records",
	"vectors",
	"note_vectors",
];
/** The tables of the vectors, for another model. */
const VECTOR_TABLES = ["records", "vectors", "note_vectors"];
/** Words around a match in an excerpt. */
const SNIPPET_TOKENS = 16;

/** Marks a match in a section's excerpt: never in a text file. */
export const MATCH_OPEN = "\u0002";
export const MATCH_CLOSE = "\u0003";

/** Creates the tables of the index, when they are not there. */
export function createSearchTables(db: Database): void {
	db.run(
		"CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, changed_at REAL NOT NULL, sha256 TEXT NOT NULL, title TEXT NOT NULL, UNIQUE (project_id, path))",
	);
	// `id` is the row, and the row of its words in `texts`: a new one at each
	// write of the file. `section_id` is what a vector knows: see `sectionId`.
	db.run(
		"CREATE TABLE IF NOT EXISTS sections (id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, ord INTEGER NOT NULL, section_id TEXT NOT NULL, heading TEXT, heading_path TEXT NOT NULL, line INTEGER NOT NULL, page INTEGER, text TEXT NOT NULL)",
	);
	db.run("CREATE INDEX IF NOT EXISTS sections_file ON sections (file_id, ord)");
	db.run(
		"CREATE INDEX IF NOT EXISTS sections_id ON sections (file_id, section_id, ord)",
	);
	// Stemmed (deploying finds deploy), accents folded, and fast prefixes.
	db.run(
		"CREATE VIRTUAL TABLE IF NOT EXISTS texts USING fts5(path, title, heading, body, tokenize = 'porter unicode61 remove_diacritics 2', prefix = '2 3')",
	);
	// The record manager's table: which vectors `index()` stored, and when.
	db.run(
		"CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, key TEXT NOT NULL, updated_at REAL NOT NULL, group_id TEXT, PRIMARY KEY (namespace, key))",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS records_time ON records (namespace, updated_at)",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS records_group ON records (namespace, group_id)",
	);
	// The vector store's table: one row per distinct section of a project.
	db.run(
		"CREATE TABLE IF NOT EXISTS vectors (project_id TEXT NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (project_id, id))",
	);
	// One row per distinct text of a note: `close-notes.ts`. No section has these.
	db.run(
		"CREATE TABLE IF NOT EXISTS note_vectors (project_id TEXT NOT NULL, hash TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (project_id, hash))",
	);
	db.run(
		"CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
	);
}

/**
 * The SQL that keeps a file's path (`f.path`) in `folders`, as
 * `inFolders` does: the folder itself, or a path that starts with it and
 * a `/`, in the same case. No folders: no file.
 */
function folderClause(folders: readonly string[]): {
	sql: string;
	params: string[];
} {
	if (folders.length === 0) return { sql: "0", params: [] };
	return {
		sql: folders.map(() => "f.path = ? OR instr(f.path, ?) = 1").join(" OR "),
		params: folders.flatMap((folder) => [folder, `${folder}/`]),
	};
}

/** A file as the index has it. */
export type IndexedFile = {
	id: number;
	path: string;
	size: number;
	mtimeMs: number;
	sha256: string;
};

/** What a refresh found of a file: its content did not change, or it did. */
export type IndexedFileWrite =
	| { file: KnowledgeFile; row: IndexedFile; same: true }
	| {
			file: KnowledgeFile;
			row: IndexedFile | undefined;
			same: false;
			sha256: string;
			title: string;
			sections: Document<SectionMetadata>[];
	  };

/** A section the words found. `snippet` has its matches between the marks. */
type WordSection = {
	path: string;
	title: string;
	heading: string | null;
	line: number;
	page: number | null;
	snippet: string;
};

/** A section as the embedding model reads it. */
type SectionToEmbed = {
	path: string;
	title: string;
	heading_path: string;
	text: string;
	section_id: string;
};

/** The search index of the projects' knowledge on this computer. */
export type SearchStore = ReturnType<typeof createSearchStore>;

/**
 * `onVectorsGone`: what is known of the vectors no longer holds. The index
 * opened, closed or was built again, or the vectors of another model went.
 */
export function createSearchStore(
	dataDir: string,
	options: { onVectorsGone?: () => void } = {},
) {
	const root = join(dataDir, "knowledge");
	const file = join(root, KNOWLEDGE_SEARCH_FILE);
	let db: Database | null = null;
	/** The model the open index's vectors belong to. */
	let vectorModel: string | null = null;
	/** The vector store of each project, on the open index file. It keeps the project's vectors in memory. */
	const vectorStores = new Map<
		string,
		{ embeddings: KnowledgeMeaning["embeddings"]; store: BunSqliteVectorStore }
	>();

	function create(): Database {
		const sqlite = new Database(file, { create: true });
		sqlite.run("PRAGMA journal_mode = WAL");
		sqlite.run("PRAGMA synchronous = NORMAL");
		const { user_version } = sqlite
			.query<{ user_version: number }, []>("PRAGMA user_version")
			.get() ?? { user_version: 0 };
		if (user_version !== SCHEMA_VERSION) {
			for (const table of TABLES) sqlite.run(`DROP TABLE IF EXISTS ${table}`);
		}
		createSearchTables(sqlite);
		sqlite.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		return sqlite;
	}

	/** Forgets what belongs to the open index file. */
	function forget(): void {
		vectorStores.clear();
		vectorModel = null;
		options.onVectorsGone?.();
	}

	/** Throws the index away: it is derived, the next call builds it again. */
	function discard(): void {
		try {
			db?.close();
		} catch {}
		db = null;
		forget();
		for (const suffix of ["", "-wal", "-shm"]) {
			rmSync(`${file}${suffix}`, { force: true });
		}
	}

	function opened(): Database {
		if (!db) throw new Error("The search index is closed.");
		return db;
	}

	/** The model of the vectors the open index holds. */
	function modelOfVectors(sqlite: Database): string | undefined {
		return sqlite
			.query<{ value: string }, []>(
				"SELECT value FROM meta WHERE key = 'model'",
			)
			.get()?.value;
	}

	/**
	 * The model is part of the index: the vectors of another model go, and
	 * every project prepares again. Runs when the index opens and when the
	 * model changes while Night Shift runs.
	 */
	function align(sqlite: Database, model: string, force = false): void {
		if (vectorModel === model && !force) return;
		const kept = modelOfVectors(sqlite);
		vectorModel = model;
		if (kept === model && !force) return;
		for (const table of VECTOR_TABLES) sqlite.run(`DELETE FROM ${table}`);
		sqlite
			.query(
				"INSERT INTO meta (key, value) VALUES ('model', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
			)
			.run(model);
		vectorStores.clear();
		options.onVectorsGone?.();
	}

	/** The statements that drop the sections of a file and what the words know of them. */
	function sectionDroppers(sqlite: Database) {
		const texts = sqlite.prepare(
			"DELETE FROM texts WHERE rowid IN (SELECT id FROM sections WHERE file_id = ?)",
		);
		const sections = sqlite.prepare("DELETE FROM sections WHERE file_id = ?");
		return (fileId: number) => {
			texts.run(fileId);
			sections.run(fileId);
		};
	}

	return {
		/** The index, opened once. A file that does not open is derived data: it goes, and a new one is built. */
		async open(): Promise<void> {
			if (db) return;
			await mkdir(root, { recursive: true });
			forget();
			try {
				db = create();
			} catch {
				discard();
				db = create();
			}
		},
		isOpen: () => db !== null,
		/** Closes the index file. A later `open` opens it again. */
		close(): void {
			db?.close();
			db = null;
			forget();
		},
		/** `work`, and once more on a new index when the file is broken. */
		async healing<T>(work: () => Promise<T>): Promise<T> {
			try {
				return await work();
			} catch (error) {
				if (
					!/malformed|not a database|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(
						String(error),
					)
				) {
					throw error;
				}
				discard();
				return work();
			}
		},

		/** The files the index has of the project, by path. */
		files(projectId: string): Map<string, IndexedFile> {
			return new Map(
				opened()
					.query<IndexedFile, [string]>(
						"SELECT id, path, size, changed_at AS mtimeMs, sha256 FROM files WHERE project_id = ?",
					)
					.all(projectId)
					.map((row) => [row.path, row]),
			);
		},
		/** Drops files and their sections. Their vectors wait for the next preparation. */
		removeFiles(rows: readonly IndexedFile[]): void {
			const sqlite = opened();
			const dropSections = sectionDroppers(sqlite);
			const dropFile = sqlite.prepare("DELETE FROM files WHERE id = ?");
			sqlite.transaction(() => {
				for (const row of rows) {
					dropSections(row.id);
					dropFile.run(row.id);
				}
			})();
		},
		/** Writes what a refresh read. True when the sections of a file changed. */
		writeFiles(projectId: string, batch: readonly IndexedFileWrite[]): boolean {
			const sqlite = opened();
			const dropSections = sectionDroppers(sqlite);
			const addFile = sqlite.prepare<
				{ id: number },
				[string, string, number, number, string, string]
			>(
				"INSERT INTO files (project_id, path, size, changed_at, sha256, title) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
			);
			const setFile = sqlite.prepare(
				"UPDATE files SET size = ?, changed_at = ?, sha256 = ?, title = ? WHERE id = ?",
			);
			const touchFile = sqlite.prepare(
				"UPDATE files SET size = ?, changed_at = ? WHERE id = ?",
			);
			const addSection = sqlite.prepare<
				{ id: number },
				[
					number,
					number,
					string,
					string | null,
					string,
					number,
					number | null,
					string,
				]
			>(
				"INSERT INTO sections (file_id, ord, section_id, heading, heading_path, line, page, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
			);
			const addText = sqlite.prepare(
				"INSERT INTO texts (rowid, path, title, heading, body) VALUES (?, ?, ?, ?, ?)",
			);
			let moved = false;
			sqlite.transaction(() => {
				for (const item of batch) {
					const f = item.file;
					if (item.same) {
						touchFile.run(f.size, f.changedAt, item.row.id);
						continue;
					}
					moved = true;
					let id = item.row?.id;
					if (id === undefined) {
						id = (
							addFile.get(
								projectId,
								f.path,
								f.size,
								f.changedAt,
								item.sha256,
								item.title,
							) as { id: number }
						).id;
					} else {
						setFile.run(f.size, f.changedAt, item.sha256, item.title, id);
						dropSections(id);
					}
					for (const [ord, section] of item.sections.entries()) {
						const { heading, headingPath, line, page } = section.metadata;
						const added = addSection.get(
							id,
							ord,
							sectionId(f.path, item.title, headingPath, section.pageContent),
							heading,
							headingPath,
							line,
							page,
							section.pageContent,
						) as { id: number };
						addText.run(
							added.id,
							f.path,
							item.title,
							heading ?? "",
							section.pageContent,
						);
					}
				}
			})();
			return moved;
		},

		/**
		 * The sections whose words match, best first, at most `limit`. With
		 * `folders`: in those folders only, in the query, so other files take
		 * no place among the candidates.
		 */
		sectionsWithWords(
			projectId: string,
			match: string,
			limit: number,
			folders?: readonly string[],
		): WordSection[] {
			const within = folders ? folderClause(folders) : null;
			// Columns: path, title, heading, body. A word in the title counts most, then the path, then a heading.
			return opened()
				.query<WordSection, (string | number)[]>(
					`SELECT f.path AS path, f.title AS title, s.heading AS heading, s.line AS line, s.page AS page,
						snippet(texts, -1, '${MATCH_OPEN}', '${MATCH_CLOSE}', '…', ${SNIPPET_TOKENS}) AS snippet
					FROM texts t JOIN sections s ON s.id = t.rowid JOIN files f ON f.id = s.file_id
					WHERE texts MATCH ? AND f.project_id = ?${within ? ` AND (${within.sql})` : ""}
					ORDER BY bm25(texts, 3.0, 5.0, 2.0, 1.0) LIMIT ?`,
				)
				.all(match, projectId, ...(within?.params ?? []), limit);
		},
		/** The file at `path`. Null: it went. */
		fileAt(projectId: string, path: string) {
			return opened()
				.query<{ id: number; title: string }, [string, string]>(
					"SELECT id, title FROM files WHERE project_id = ? AND path = ?",
				)
				.get(projectId, path);
		},
		/** The first section of the file with this id. Null: the file has none. */
		section(fileId: number, id: string) {
			return opened()
				.query<
					{
						heading: string | null;
						line: number;
						page: number | null;
						text: string;
					},
					[number, string]
				>(
					"SELECT heading, line, page, text FROM sections WHERE file_id = ? AND section_id = ? ORDER BY ord LIMIT 1",
				)
				.get(fileId, id);
		},
		/** The sections that get a vector: the ones with text. */
		sectionsToEmbed(projectId: string): SectionToEmbed[] {
			return opened()
				.query<SectionToEmbed, [string]>(
					`SELECT f.path AS path, f.title AS title, s.heading_path AS heading_path, s.text AS text, s.section_id AS section_id
					FROM sections s JOIN files f ON f.id = s.file_id
					WHERE f.project_id = ? AND s.text != ''
					ORDER BY f.path, s.ord`,
				)
				.all(projectId);
		},
		/** How many sections get a vector. */
		sectionCount(projectId: string): number {
			return (
				opened()
					.query<{ n: number }, [string]>(
						"SELECT count(*) AS n FROM sections s JOIN files f ON f.id = s.file_id WHERE f.project_id = ? AND s.text != ''",
					)
					.get(projectId)?.n ?? 0
			);
		},

		/**
		 * The sections of the project's files with text, by path and in order,
		 * up to `maxBytes` in all and `maxBytesPerFile` of a file, and how many
		 * files that left out. Whole sections: the Map counts their words.
		 */
		sectionTexts(
			projectId: string,
			limits: { maxBytes: number; maxBytesPerFile: number },
		): {
			read: { path: string; sections: string[] }[];
			filesLeftOut: number;
		} {
			const sqlite = opened();
			const read: { path: string; sections: string[] }[] = [];
			let left = limits.maxBytes;
			let inFile = 0;
			// Its own statement: this stops halfway, and a kept statement that
			// stopped halfway cannot run again.
			const sections = sqlite.prepare<{ path: string; text: string }, [string]>(
				`SELECT f.path AS path, s.text AS text
				FROM sections s JOIN files f ON f.id = s.file_id
				WHERE f.project_id = ? AND s.text != ''
				ORDER BY f.path, s.ord`,
			);
			try {
				for (const row of sections.iterate(projectId)) {
					if (read.at(-1)?.path !== row.path) {
						// The next file does not fit: the rest stays out.
						if (left <= 0) break;
						read.push({ path: row.path, sections: [] });
						inFile = 0;
					}
					if (inFile >= limits.maxBytesPerFile) continue;
					const size = Buffer.byteLength(row.text);
					inFile += size;
					left -= size;
					read.at(-1)?.sections.push(row.text);
				}
			} finally {
				sections.finalize();
			}
			const all =
				sqlite
					.query<{ n: number }, [string]>(
						`SELECT count(DISTINCT f.id) AS n
						FROM sections s JOIN files f ON f.id = s.file_id
						WHERE f.project_id = ? AND s.text != ''`,
					)
					.get(projectId)?.n ?? 0;
			return { read, filesLeftOut: Math.max(0, all - read.length) };
		},
		/**
		 * The vectors of this model that still belong to a section of a file, at
		 * most `limit`: the first section of each file, then the second of each,
		 * so a cut leaves no file out. By path, from the store's own table: it
		 * reads no model, and it changes nothing. Another model's vectors: none.
		 */
		storedVectors(
			projectId: string,
			model: string,
			limit: number,
		): { path: string; vector: Float32Array }[] {
			const sqlite = opened();
			if (modelOfVectors(sqlite) !== model) return [];
			return sqlite
				.query<{ path: string; vec: Uint8Array }, [string, number]>(
					`WITH held AS (
						SELECT v.rowid AS row, f.path AS path, min(s.ord) AS ord
						FROM vectors v
						JOIN files f ON f.project_id = v.project_id AND f.path = json_extract(v.metadata, '$.path')
						JOIN sections s ON s.file_id = f.id AND s.section_id = json_extract(v.metadata, '$.section_id')
						WHERE v.project_id = ?
						GROUP BY v.rowid
					), ranked AS (
						SELECT row, path, row_number() OVER (PARTITION BY path ORDER BY ord) AS nth FROM held
					)
					SELECT r.path AS path, v.vec AS vec
					FROM ranked r JOIN vectors v ON v.rowid = r.row
					ORDER BY r.nth, r.path LIMIT ?`,
				)
				.all(projectId, limit)
				.map(({ path, vec }) => ({
					path,
					vector: new Float32Array(vec.slice().buffer),
				}));
		},

		/** The vectors of the project's notes, by the hash of their text. It reads no model. Another model's vectors: none. */
		noteVectors(projectId: string, model: string): Map<string, Float32Array> {
			const sqlite = opened();
			if (modelOfVectors(sqlite) !== model) return new Map();
			return new Map(
				sqlite
					.query<{ hash: string; vec: Uint8Array }, [string]>(
						"SELECT hash, vec FROM note_vectors WHERE project_id = ?",
					)
					.all(projectId)
					.map(({ hash, vec }) => [hash, new Float32Array(vec.slice().buffer)]),
			);
		},
		/** Which notes of the project have a vector of this model. */
		noteHashes(projectId: string, model: string): Set<string> {
			const sqlite = opened();
			if (modelOfVectors(sqlite) !== model) return new Set();
			return new Set(
				sqlite
					.query<{ hash: string }, [string]>(
						"SELECT hash FROM note_vectors WHERE project_id = ?",
					)
					.all(projectId)
					.map(({ hash }) => hash),
			);
		},
		/** Stores vectors of the project's notes. The vectors of another model go first. */
		writeNoteVectors(
			projectId: string,
			model: string,
			rows: readonly { hash: string; vector: readonly number[] }[],
		): void {
			const sqlite = opened();
			align(sqlite, model);
			const put = sqlite.prepare(
				"INSERT OR REPLACE INTO note_vectors (project_id, hash, vec) VALUES (?, ?, ?)",
			);
			sqlite.transaction(() => {
				for (const { hash, vector } of rows) {
					put.run(
						projectId,
						hash,
						new Uint8Array(new Float32Array(vector).buffer),
					);
				}
			})();
		},
		/** Drops the vectors of the project's notes that are not these. */
		keepNoteVectors(projectId: string, hashes: readonly string[]): void {
			const sqlite = opened();
			const keep = new Set(hashes);
			const gone = sqlite
				.query<{ hash: string }, [string]>(
					"SELECT hash FROM note_vectors WHERE project_id = ?",
				)
				.all(projectId)
				.filter(({ hash }) => !keep.has(hash));
			const drop = sqlite.prepare(
				"DELETE FROM note_vectors WHERE project_id = ? AND hash = ?",
			);
			sqlite.transaction(() => {
				for (const { hash } of gone) drop.run(projectId, hash);
			})();
		},

		/** The project's vector store for this model. The vectors of another model go first. */
		vectorsFor(
			projectId: string,
			model: Pick<KnowledgeMeaning, "model" | "embeddings">,
		): BunSqliteVectorStore {
			const sqlite = opened();
			align(sqlite, model.model);
			const kept = vectorStores.get(projectId);
			if (kept?.embeddings === model.embeddings) return kept.store;
			const store = new BunSqliteVectorStore(
				model.embeddings,
				sqlite,
				projectId,
			);
			vectorStores.set(projectId, { embeddings: model.embeddings, store });
			return store;
		},
		/** The record manager of the project's vectors. */
		recordsOf: (projectId: string) =>
			new BunSqliteRecordManager(opened(), `knowledge:${projectId}`),
		/** The model the vectors belong to now. Null: closed, or no model asked yet. */
		vectorModel: () => vectorModel,
		/** Drops every vector: a model embedded while this one took over, so its vectors may be mixed in. */
		resetVectors(model: string): void {
			align(opened(), model, true);
		},
	};
}
