import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { KNOWLEDGE_SEARCH_FILE } from "@nightshift/flows";
import { mapStamp, sectionTexts, storedVectors } from "./map-reads";
import {
	createSearchTables,
	folderClause,
	modelOfVectors,
	SCHEMA_VERSION,
	TABLES,
	VECTOR_TABLES,
} from "./tables";
import { BunSqliteRecordManager, BunSqliteVectorStore } from "./vectors";

/**
 * The search index on disk: `<dataDir>/knowledge/.search.sqlite`, and the
 * one module that reads and writes its tables (`tables.ts`). The file is a
 * rebuildable cache: a version that differs, or a file that does not open,
 * builds a new one.
 *
 * Whatever needs the tables crosses this interface: the refresh writes files
 * and sections, the query reads them, and the vector preparation reads
 * sections and gets the vector store and record manager of a project. The
 * knowledge search decides what goes in and how it ranks.
 */

/** Words around a match in an excerpt. */
const SNIPPET_TOKENS = 16;

/** Marks a match in a section's excerpt: never in a text file. */
export const MATCH_OPEN = "\u0002";
export const MATCH_CLOSE = "\u0003";

/** A file of the folder as a refresh found it. */
type IndexedFileStamp = {
	/** Relative to the folder, with `/` between its parts. */
	path: string;
	/** Bytes. */
	size: number;
	/** Epoch ms: the file's time of change. */
	changedAt: number;
};

/** A section of a file, as the index keeps it. `id` is the caller's: what a vector knows of the section. */
export type IndexedSection = {
	id: string;
	heading: string | null;
	headingPath: string;
	line: number;
	page: number | null;
	text: string;
};

/** The embedding model the vectors belong to. */
type VectorModel = { model: string; embeddings: EmbeddingsInterface };

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
	| { file: IndexedFileStamp; row: IndexedFile; same: true }
	| {
			file: IndexedFileStamp;
			row: IndexedFile | undefined;
			same: false;
			sha256: string;
			title: string;
			sections: readonly IndexedSection[];
	  };

/** A section the words found. `snippet` has its matches between the marks. */
export type WordSection = {
	path: string;
	title: string;
	heading: string | null;
	line: number;
	page: number | null;
	snippet: string;
};

/** A section as the embedding model reads it. */
export type SectionToEmbed = {
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
	/** Counts each time the open index file was let go: what holds a handle of an older one holds a closed one. */
	let opening = 0;
	/** The vector store of each project, on the open index file. It keeps the project's vectors in memory. */
	const vectorStores = new Map<
		string,
		{ embeddings: EmbeddingsInterface; store: BunSqliteVectorStore }
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
		opening += 1;
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
		/** Which opening of the index this is: another number means the file closed in between. */
		opening: () => opening,
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
						const { heading, headingPath, line, page, text } = section;
						const added = addSection.get(
							id,
							ord,
							section.id,
							heading,
							headingPath,
							line,
							page,
							text,
						) as { id: number };
						addText.run(added.id, f.path, item.title, heading ?? "", text);
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

		/** The Map's reads (`map-reads.ts`). */
		sectionTexts: (
			projectId: string,
			limits: { maxBytes: number; maxBytesPerFile: number },
		) => sectionTexts(opened(), projectId, limits),
		mapStamp: (projectId: string) => mapStamp(opened(), projectId),
		storedVectors: (projectId: string, model: string, limit: number) =>
			storedVectors(opened(), projectId, model, limit),

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
		vectorsFor(projectId: string, model: VectorModel): BunSqliteVectorStore {
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
