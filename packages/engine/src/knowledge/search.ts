import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { documentText, isDocument } from "./documents";
import {
	createKnowledgeFolders,
	cutText,
	describeDocumentText,
	describeText,
	fallbackTitle,
	type KnowledgeFile,
	readStart,
	TEXT_FILES,
} from "./folder";

/**
 * Full-text search over a project's knowledge folder, on this Device.
 *
 * The index is derived data, never synced (ADR 4, decision 7): an SQLite
 * FTS5 table in its own file, `<dataDir>/knowledge/.search.sqlite`, next to
 * the projects' folders. It is not in the Replica: nothing else reads it,
 * it must not travel with the Replica's data, and a search that writes it
 * never waits on the Replica's writers. Delete the file and the next search
 * builds it again.
 *
 * It has no hooks. Before each search it walks the folder and indexes
 * again only the files whose size or time of change differ, and drops the
 * ones that went. So it stays right whoever changes the folder: a sync
 * kit, a person, or the Space's knowledge as it arrives.
 *
 * It indexes the text files (`TEXT_FILES`) the index lists, and the text
 * of PDF and Word files (`documents.ts`): the files a person or an agent
 * reads (`isReadable`), so not `INDEX.md`, hidden files or the learnings
 * that wait for a person. A document over 10 MB is found by its path only.
 * Reading one file is `KnowledgeSync.read`.
 */

/** A part of a hit's excerpt: `match` parts are the words the query found. */
export type KnowledgeSnippetPart = { text: string; match: boolean };

/** A file a search found. */
export type KnowledgeHit = {
	/** Relative to the folder, with `/` between its parts. */
	path: string;
	title: string;
	/** A short excerpt around the best match, in parts. */
	snippet: KnowledgeSnippetPart[];
	/** How well it matches (BM25): higher is better. Only compares hits of one search. */
	score: number;
};

/** What a refresh did. */
export type KnowledgeRefresh = {
	/** Text files the folder has now. */
	files: number;
	/** Files read and indexed again: new or changed. */
	indexed: number;
	/** Files that went. */
	removed: number;
};

/** The index file, hidden so no project id can name it. */
export const SEARCH_FILE = ".search.sqlite";
/** Bump to build every index again. 2: PDF and Word files. 3: their text through LangChain loaders. */
const SCHEMA_VERSION = 3;
/** What the index reads of a file: past this, the end of a very large file is not found. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Files read at once while indexing. */
const BATCH = 64;
/** Hits a search returns by default, and at most. */
const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 50;
/** Words around a match in an excerpt. */
const SNIPPET_TOKENS = 16;

/** Marks a match in `snippet()` output: never in a text file. */
const OPEN = "\u0002";
const CLOSE = "\u0003";

const isText = (path: string) => TEXT_FILES.has(extname(path).toLowerCase());
/** The files the index reads: text files and documents. */
const isIndexed = (path: string) => isText(path) || isDocument(path);

/**
 * The FTS5 query for what a person or an agent typed, or null when it has
 * no word. Every word is quoted, so no input is FTS5 syntax: `"a phrase"`
 * stays a phrase, a word ending in `*` matches as a prefix, and so does the
 * last word (search as you type). `all`: every word must match. `any`: one
 * is enough.
 */
export function matchQuery(input: string, mode: "all" | "any"): string | null {
	const terms: { text: string; phrase: boolean; prefix: boolean }[] = [];
	for (const found of input.matchAll(/"([^"]*)"|(\S+)/g)) {
		const phrase = found[1] !== undefined;
		const raw = (found[1] ?? found[2] ?? "").replace(/"/g, " ").trim();
		const prefix = !phrase && raw.endsWith("*");
		const text = raw.replace(/\*+$/, "").trim();
		if (!/[\p{L}\p{N}]/u.test(text)) continue;
		terms.push({ text, phrase, prefix });
	}
	const last = terms.at(-1);
	if (!last) return null;
	if (!last.phrase) last.prefix = true;
	return terms
		.map((term) => `"${term.text}"${term.prefix ? "*" : ""}`)
		.join(mode === "all" ? " " : " OR ");
}

/** A `snippet()` result as parts, its lines as one. */
function snippetParts(raw: string): KnowledgeSnippetPart[] {
	const parts: KnowledgeSnippetPart[] = [];
	const push = (text: string, match: boolean) => {
		const flat = text.replace(/\s+/g, " ");
		if (flat === "") return;
		const prev = parts.at(-1);
		if (prev && prev.match === match) prev.text += flat;
		else parts.push({ text: flat, match });
	};
	let rest = raw;
	while (rest !== "") {
		const start = rest.indexOf(OPEN);
		if (start < 0) {
			push(rest, false);
			break;
		}
		push(rest.slice(0, start), false);
		const end = rest.indexOf(CLOSE, start);
		const stop = end < 0 ? rest.length : end;
		push(rest.slice(start + 1, stop), true);
		rest = end < 0 ? "" : rest.slice(end + 1);
	}
	const first = parts[0];
	if (first && !first.match) first.text = first.text.trimStart();
	const final = parts.at(-1);
	if (final && !final.match) final.text = final.text.trimEnd();
	return parts.filter((part) => part.text !== "");
}

type Row = { id: number; path: string; size: number; changed_at: number };

/** Search over the projects' knowledge folders on this computer. */
export type KnowledgeSearch = ReturnType<typeof createKnowledgeSearch>;

export function createKnowledgeSearch(dataDir: string) {
	const folders = createKnowledgeFolders(dataDir);
	const root = join(dataDir, "knowledge");
	const file = join(root, SEARCH_FILE);
	let db: Database | null = null;
	/** One refresh per project at a time: a second search waits for it. */
	const refreshing = new Map<string, Promise<KnowledgeRefresh>>();

	function create(): Database {
		const sqlite = new Database(file, { create: true });
		sqlite.run("PRAGMA journal_mode = WAL");
		sqlite.run("PRAGMA synchronous = NORMAL");
		const { user_version } = sqlite
			.query<{ user_version: number }, []>("PRAGMA user_version")
			.get() ?? { user_version: 0 };
		if (user_version !== SCHEMA_VERSION) {
			sqlite.run("DROP TABLE IF EXISTS files");
			sqlite.run("DROP TABLE IF EXISTS texts");
		}
		sqlite.run(
			"CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, changed_at REAL NOT NULL, UNIQUE (project_id, path))",
		);
		// Stemmed (deploying finds deploy), accents folded, and fast prefixes.
		sqlite.run(
			"CREATE VIRTUAL TABLE IF NOT EXISTS texts USING fts5(path, title, body, tokenize = 'porter unicode61 remove_diacritics 2', prefix = '2 3')",
		);
		sqlite.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		return sqlite;
	}

	/** Throws the index away: it is derived, the next call builds it again. */
	function discard(): void {
		try {
			db?.close();
		} catch {}
		db = null;
		for (const suffix of ["", "-wal", "-shm"]) {
			rmSync(`${file}${suffix}`, { force: true });
		}
	}

	/** `work`, and once more on a new index when the file is broken. */
	async function healing<T>(work: () => Promise<T>): Promise<T> {
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
	}

	/** The index, opened once. A file that does not open is derived data: it goes, and a new one is built. */
	async function database(): Promise<Database> {
		if (db) return db;
		await mkdir(root, { recursive: true });
		try {
			db = create();
		} catch {
			discard();
			db = create();
		}
		return db;
	}

	async function update(projectId: string): Promise<KnowledgeRefresh> {
		const dir = folders.folder(projectId);
		const files = (await folders.files(projectId)).filter((f) =>
			isIndexed(f.path),
		);
		const sqlite = await database();
		const known = new Map(
			sqlite
				.query<Row, [string]>(
					"SELECT id, path, size, changed_at FROM files WHERE project_id = ?",
				)
				.all(projectId)
				.map((row) => [row.path, row]),
		);
		const changed: KnowledgeFile[] = [];
		for (const f of files) {
			const row = known.get(f.path);
			known.delete(f.path);
			if (!row || row.size !== f.size || row.changed_at !== f.changedAt) {
				changed.push(f);
			}
		}
		const gone = [...known.values()];

		const dropFile = sqlite.prepare("DELETE FROM files WHERE id = ?");
		const dropText = sqlite.prepare("DELETE FROM texts WHERE rowid = ?");
		const addFile = sqlite.prepare<
			{ id: number },
			[string, string, number, number]
		>(
			"INSERT INTO files (project_id, path, size, changed_at) VALUES (?, ?, ?, ?) RETURNING id",
		);
		const setFile = sqlite.prepare(
			"UPDATE files SET size = ?, changed_at = ? WHERE id = ?",
		);
		const addText = sqlite.prepare(
			"INSERT INTO texts (rowid, path, title, body) VALUES (?, ?, ?, ?)",
		);

		if (gone.length > 0) {
			sqlite.transaction(() => {
				for (const row of gone) {
					dropText.run(row.id);
					dropFile.run(row.id);
				}
			})();
		}

		const ids = new Map(
			sqlite
				.query<{ id: number; path: string }, [string]>(
					"SELECT id, path FROM files WHERE project_id = ?",
				)
				.all(projectId)
				.map((row) => [row.path, row.id]),
		);
		for (let at = 0; at < changed.length; at += BATCH) {
			const batch = await Promise.all(
				changed.slice(at, at + BATCH).map(async (f) => {
					const abs = join(dir, ...f.path.split("/"));
					const name = f.path.split("/").at(-1) ?? f.path;
					const fallback = fallbackTitle(f.path);
					if (isDocument(f.path)) {
						const text = await documentText(abs);
						if (text === null) return { file: f, title: name, body: "" };
						const body = cutText(text, MAX_BODY_BYTES).text;
						return {
							file: f,
							title: describeDocumentText(body.slice(0, 4096), fallback).title,
							body,
						};
					}
					const read = await readStart(abs, MAX_BODY_BYTES);
					const body = read?.text ?? "";
					return {
						file: f,
						title: describeText(body.slice(0, 4096), fallback).title,
						body,
					};
				}),
			);
			sqlite.transaction(() => {
				for (const { file: f, title, body } of batch) {
					let id = ids.get(f.path);
					if (id === undefined) {
						id = (
							addFile.get(projectId, f.path, f.size, f.changedAt) as {
								id: number;
							}
						).id;
						ids.set(f.path, id);
					} else {
						setFile.run(f.size, f.changedAt, id);
						dropText.run(id);
					}
					addText.run(id, f.path, title, body);
				}
			})();
		}
		return {
			files: files.length,
			indexed: changed.length,
			removed: gone.length,
		};
	}

	/** The project's index brought up to date with its folder. */
	function refresh(projectId: string): Promise<KnowledgeRefresh> {
		const running = refreshing.get(projectId);
		if (running) return running;
		const next = update(projectId).finally(() => refreshing.delete(projectId));
		refreshing.set(projectId, next);
		return next;
	}

	function query(
		sqlite: Database,
		projectId: string,
		match: string,
		limit: number,
	): KnowledgeHit[] {
		// Columns: path, title, body. A word in the title counts most, then the path.
		const rows = sqlite
			.query<
				{ path: string; title: string; snippet: string; rank: number },
				[string, string, number]
			>(
				`SELECT f.path AS path, t.title AS title,
					snippet(texts, -1, '${OPEN}', '${CLOSE}', '…', ${SNIPPET_TOKENS}) AS snippet,
					bm25(texts, 3.0, 5.0, 1.0) AS rank
				FROM texts t JOIN files f ON f.id = t.rowid
				WHERE texts MATCH ? AND f.project_id = ?
				ORDER BY rank LIMIT ?`,
			)
			.all(match, projectId, limit);
		return rows.map((row) => ({
			path: row.path,
			title: row.title,
			snippet: snippetParts(row.snippet),
			score: Math.round(-row.rank * 1000) / 1000,
		}));
	}

	return {
		refresh,
		/**
		 * The files of the project's knowledge that best match `text`, best
		 * first, after a refresh. Every word must match. When no file has
		 * them all, files with some of them. No input makes it throw.
		 */
		async search(
			projectId: string,
			text: string,
			options: { limit?: number } = {},
		): Promise<KnowledgeHit[]> {
			const limit = Math.min(
				Math.max(1, Math.floor(options.limit ?? LIMIT_DEFAULT)),
				LIMIT_MAX,
			);
			const all = matchQuery(text, "all");
			if (all === null) return [];
			return healing(async () => {
				await refresh(projectId);
				const sqlite = await database();
				const hits = query(sqlite, projectId, all, limit);
				if (hits.length > 0) return hits;
				const any = matchQuery(text, "any");
				return any === null || any === all
					? hits
					: query(sqlite, projectId, any, limit);
			});
		},
		/** Closes the index file. A later call opens it again. */
		close(): void {
			db?.close();
			db = null;
		},
	};
}
