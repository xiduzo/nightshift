import type { Database } from "bun:sqlite";

/**
 * The tables of the search index, and their version. All the DDL is here,
 * the vector tables included, so a change of a table cannot forget the bump.
 */

/** Bump to build every index again: a new table needs no bump, since each open creates it. 2: PDF and Word files. 3: their text through LangChain loaders. 4: sections, and vectors by meaning. 5: a section's stable id, on its row and in its vector's metadata, and its heading path, which the model reads. */
export const SCHEMA_VERSION = 5;
/** Every table of the index, for an index built again. */
export const TABLES = [
	"files",
	"texts",
	"sections",
	"meta",
	"records",
	"vectors",
	"note_vectors",
];
/** The tables of the vectors, for another model. */
export const VECTOR_TABLES = ["records", "vectors", "note_vectors"];

/** Creates the tables of the index, when they are not there. */
export function createSearchTables(db: Database): void {
	db.run(
		"CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, changed_at REAL NOT NULL, sha256 TEXT NOT NULL, title TEXT NOT NULL, UNIQUE (project_id, path))",
	);
	// `id` is the row, and the row of its words in `texts`: a new one at each
	// write of the file. `section_id` is what a vector knows: the caller's id
	// of the section.
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
	// One row per distinct text of a note: the close notes of the knowledge. No section has these.
	db.run(
		"CREATE TABLE IF NOT EXISTS note_vectors (project_id TEXT NOT NULL, hash TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (project_id, hash))",
	);
	db.run(
		"CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
	);
}

/**
 * The SQL that keeps a file's path (`f.path`) in `folders`: the folder
 * itself, or a path that starts with it and a `/`, in the same case. No
 * folders: no file.
 */
export function folderClause(folders: readonly string[]): {
	sql: string;
	params: string[];
} {
	if (folders.length === 0) return { sql: "0", params: [] };
	return {
		sql: folders.map(() => "f.path = ? OR instr(f.path, ?) = 1").join(" OR "),
		params: folders.flatMap((folder) => [folder, `${folder}/`]),
	};
}

/** The model of the vectors the index holds. */
export function modelOfVectors(sqlite: Database): string | undefined {
	return sqlite
		.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'model'")
		.get()?.value;
}
