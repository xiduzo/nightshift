import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { Document } from "@langchain/core/documents";
import { index } from "@langchain/core/indexing";
import { sha256OfFile } from "../archive";
import { isDocument, loadDocument } from "./documents";
import {
	createKnowledgeFolders,
	cutText,
	describeDocument,
	describeText,
	fallbackTitle,
	type KnowledgeFile,
	readStart,
	TEXT_FILES,
} from "./folder";
import type { KnowledgeMeaning, KnowledgeMeaningReady } from "./meaning";
import { type SectionMetadata, splitSections } from "./sections";
import {
	BunSqliteRecordManager,
	BunSqliteVectorStore,
	createVectorTables,
	VECTOR_TABLES,
} from "./vectors";

/**
 * Search over a project's knowledge folder, on this Device: by words, and
 * by meaning when this computer can.
 *
 * The index is derived data, never synced (ADR 4, decision 7): an SQLite
 * file of its own, `<dataDir>/knowledge/.search.sqlite`, next to the
 * projects' folders. It is not in the Replica: nothing else reads it, it
 * must not travel with the Replica's data, and a search that writes it
 * never waits on the Replica's writers. Delete the file and the next
 * search builds it again.
 *
 * It has no hooks. Before each search it walks the folder and reads again
 * only the files whose size or time of change differ, and drops the ones
 * that went. A file whose content hash (the sha256 the `knowledge:<id>`
 * document holds) did not change is not split again. So it stays right
 * whoever changes the folder: a sync kit, a person, or the Space's
 * knowledge as it arrives.
 *
 * Each file is cut into sections (`sections.ts`), so a hit points at a
 * part of a file. Words: an FTS5 table of the sections, ranked by BM25.
 * Meaning (`meaning.ts`): a vector per section, kept current in the
 * background by LangChain's `index()` after each change, never during a
 * search. A search fuses both lists by file with reciprocal rank fusion.
 * A file found by meaning alone must pass the model's floor
 * (`KnowledgeMeaning.floor`): a query no file matches finds nothing.
 * Without Ollama, or before the first vectors, it finds by words only.
 *
 * It indexes the text files (`TEXT_FILES`) the index lists, and the text
 * of PDF and Word files (`documents.ts`): the files a person or an agent
 * reads (`isReadable`), so not `INDEX.md`, hidden files or the learnings
 * that wait for a person. A document over 10 MB is found by its path only.
 * Reading one file is `KnowledgeSync.read`.
 */

/** A part of a hit's excerpt: `match` parts are the words the query found. */
export type KnowledgeSnippetPart = { text: string; match: boolean };

/** How a search found a file: by the words of the query, or by its meaning. */
export type KnowledgeFound = "words" | "meaning";

/** A file a search found, at its best section. */
export type KnowledgeHit = {
	/** Relative to the folder, with `/` between its parts. */
	path: string;
	title: string;
	/** The heading of the section the hit is in. Null: no heading above it. */
	section: string | null;
	/** The line where that section starts, from 1: of the file, or of its page. */
	line: number;
	/** The page of a PDF that section is on, from 1. Null: the file has no pages. */
	page: number | null;
	/** A short excerpt of the section: around the words found, else its start. */
	snippet: KnowledgeSnippetPart[];
	/** How well it matches: higher is better. Only compares hits of one search. */
	score: number;
	/** How the search found it: by its words, by its meaning, or both. */
	found: KnowledgeFound[];
};

/**
 * How a search finds: by the words of the query, by its meaning, or both
 * fused (the default). The evaluation (`evaluate.ts`) compares them.
 */
export type KnowledgeSearchMode = "words" | "meaning" | "both";

/** What a refresh did. */
export type KnowledgeRefresh = {
	/** Text files the folder has now. */
	files: number;
	/** Files read and indexed again: new or changed. */
	indexed: number;
	/** Files that went. */
	removed: number;
};

/**
 * Whether search by meaning works for a project on this computer.
 * `off`: no model is set up. `turned-off`: a person turned it off for the
 * project. `no-ollama`: Ollama does not answer. `no-model`: Ollama does
 * not have the model. `preparing`: the first vectors are on their way,
 * `done` of `total` sections. `on`: every section has its vector.
 */
export type KnowledgeMeaningStatus = {
	state:
		| "off"
		| "turned-off"
		| Exclude<KnowledgeMeaningReady, "ready">
		| "preparing"
		| "on";
	/** The embedding model. Null when it is off. */
	model: string | null;
	done: number;
	total: number;
};

/** The index file, hidden so no project id can name it. */
export const SEARCH_FILE = ".search.sqlite";
/** Bump to build every index again. 2: PDF and Word files. 3: their text through LangChain loaders. 4: sections, and vectors by meaning. */
const SCHEMA_VERSION = 4;
/** What the index reads of a file: past this, the end of a very large file is not found. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Files read at once while indexing. */
const BATCH = 64;
/** Hits a search returns by default, and at most. */
const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 50;
/** Files each list gives to the fusion, at least. */
const FUSE_DEPTH = 20;
/** Sections each list reads to find its best files. */
const SECTION_CANDIDATES = 200;
/** Reciprocal rank fusion's constant: a file at rank r of a list adds 1 / (60 + r). */
const RRF_C = 60;
/** Words around a match in an excerpt. */
const SNIPPET_TOKENS = 16;
/** Characters of a section's start, as the excerpt of a hit found by meaning only. */
const SNIPPET_CHARS = 180;
/** Sections embedded in one call to the model. */
const EMBED_BATCH = 32;
/** How long a search waits for the query's vector before it finds by words only. */
const QUERY_TIMEOUT_MS = 8_000;
/** After a failed preparation, how long until the next try. */
const RETRY_MS = 60_000;

/** Marks a match in `snippet()` output: never in a text file. */
const OPEN = "\u0002";
const CLOSE = "\u0003";

const isText = (path: string) => TEXT_FILES.has(extname(path).toLowerCase());
/** The files the index reads: text files and documents. */
const isIndexed = (path: string) => isText(path) || isDocument(path);

/** What the model embeds of a section: the file's title, then the section. */
const embedText = (title: string, text: string) => `${title}\n\n${text}`;

/**
 * Reciprocal rank fusion: each list adds 1 / (c + rank) to each key it
 * has, from rank 1. Best first. A tie keeps the order the keys first came in.
 */
export function fuseRanks(
	lists: readonly (readonly string[])[],
	c = RRF_C,
): { key: string; score: number }[] {
	const scores = new Map<string, number>();
	for (const list of lists) {
		for (const [i, key] of list.entries()) {
			scores.set(key, (scores.get(key) ?? 0) + 1 / (c + i + 1));
		}
	}
	return [...scores]
		.map(([key, score]) => ({ key, score }))
		.sort((a, b) => b.score - a.score);
}

/** The start of a section as an excerpt: its text after the heading, on one line. A heading alone stays. */
function sectionStart(text: string): KnowledgeSnippetPart[] {
	const flat = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ").trim();
	const lines = text.split("\n");
	const body =
		flat(lines.filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))) ||
		flat(lines.map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, "")));
	if (body === "") return [];
	if (body.length <= SNIPPET_CHARS) return [{ text: body, match: false }];
	const cut = body.slice(0, SNIPPET_CHARS);
	const space = cut.lastIndexOf(" ");
	return [
		{
			text: `${(space > SNIPPET_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`,
			match: false,
		},
	];
}

/** The pages of a document up to `bytes` of text: past that, the end is not found. */
function firstPages(docs: Document[], bytes: number): Document[] {
	const out: Document[] = [];
	let left = bytes;
	for (const doc of docs) {
		if (left <= 0) break;
		const cut = cutText(doc.pageContent, left);
		out.push(new Document({ pageContent: cut.text, metadata: doc.metadata }));
		left -= Buffer.byteLength(cut.text);
	}
	return out;
}

/** A promise that gives up after `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`No answer within ${ms} ms.`)),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

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

type Row = {
	id: number;
	path: string;
	size: number;
	changed_at: number;
	sha256: string;
};

/** A file the words found, at its best section. */
type WordsHit = {
	path: string;
	title: string;
	heading: string | null;
	line: number;
	page: number | null;
	snippet: KnowledgeSnippetPart[];
};

/** A file the meaning found, at its best section. */
type MeaningHit = {
	/** How similar its best section is to the query (cosine). */
	similarity: number;
	path: string;
	title: string;
	heading: string | null;
	line: number;
	page: number | null;
	snippet: KnowledgeSnippetPart[];
};

/** Search over the projects' knowledge folders on this computer. */
export type KnowledgeSearch = ReturnType<typeof createKnowledgeSearch>;

/**
 * `meaning`: the embedding model for search by meaning. Without it, search
 * finds by words only. `meaningOn`: whether a person left search by
 * meaning on for a project (the project's setting, `knowledge-document.ts`).
 * Off: the project is searched by words only, and its vectors are not
 * prepared. Default: on.
 */
export function createKnowledgeSearch(
	dataDir: string,
	options: {
		meaning?: KnowledgeMeaning;
		meaningOn?: (projectId: string) => Promise<boolean>;
	} = {},
) {
	const { meaning } = options;
	/** Whether search by meaning is on for the project: a setting that cannot be read leaves it on. */
	const meaningOn = (projectId: string): Promise<boolean> =>
		options.meaningOn
			? options.meaningOn(projectId).catch(() => true)
			: Promise.resolve(true);
	const folders = createKnowledgeFolders(dataDir);
	const root = join(dataDir, "knowledge");
	const file = join(root, SEARCH_FILE);
	let db: Database | null = null;
	let closed = false;
	/** One refresh per project at a time: a second search waits for it. */
	const refreshing = new Map<string, Promise<KnowledgeRefresh>>();

	/** The vector store of each project, on the open index file. */
	const stores = new Map<string, BunSqliteVectorStore>();
	/** Projects whose sections all have their vectors, since this index opened. */
	const synced = new Set<string>();
	/** A count per project that goes up when its sections change. */
	const generation = new Map<string, number>();
	/** Projects waiting for, or in, a preparation of their vectors. */
	const queued = new Set<string>();
	/** When a preparation of a project last failed. */
	const failedAt = new Map<string, number>();
	/** Projects whose setting turned search by meaning off, as last read. */
	const turnedOff = new Set<string>();
	/** Reads the project's setting again: off, its vectors are not prepared. */
	async function readSetting(projectId: string): Promise<boolean> {
		const on = await meaningOn(projectId);
		if (on) turnedOff.delete(projectId);
		else turnedOff.add(projectId);
		return on;
	}
	/** Preparations run one project at a time, in the background. */
	let preparing: Promise<void> = Promise.resolve();
	/** What the last check of the model said, to log a change once. */
	let lastReady: KnowledgeMeaningReady | null = null;
	let queryFailed = false;

	function create(): Database {
		const sqlite = new Database(file, { create: true });
		sqlite.run("PRAGMA journal_mode = WAL");
		sqlite.run("PRAGMA synchronous = NORMAL");
		const { user_version } = sqlite
			.query<{ user_version: number }, []>("PRAGMA user_version")
			.get() ?? { user_version: 0 };
		if (user_version !== SCHEMA_VERSION) {
			for (const table of [
				"files",
				"texts",
				"sections",
				"meta",
				...VECTOR_TABLES,
			]) {
				sqlite.run(`DROP TABLE IF EXISTS ${table}`);
			}
		}
		sqlite.run(
			"CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, changed_at REAL NOT NULL, sha256 TEXT NOT NULL, title TEXT NOT NULL, UNIQUE (project_id, path))",
		);
		sqlite.run(
			"CREATE TABLE IF NOT EXISTS sections (id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, ord INTEGER NOT NULL, heading TEXT, line INTEGER NOT NULL, page INTEGER, text TEXT NOT NULL)",
		);
		sqlite.run(
			"CREATE INDEX IF NOT EXISTS sections_file ON sections (file_id, ord)",
		);
		// Stemmed (deploying finds deploy), accents folded, and fast prefixes.
		sqlite.run(
			"CREATE VIRTUAL TABLE IF NOT EXISTS texts USING fts5(path, title, heading, body, tokenize = 'porter unicode61 remove_diacritics 2', prefix = '2 3')",
		);
		createVectorTables(sqlite);
		sqlite.run(
			"CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
		if (meaning) {
			// The model is part of the index: another model's vectors go.
			const kept = sqlite
				.query<{ value: string }, []>(
					"SELECT value FROM meta WHERE key = 'model'",
				)
				.get()?.value;
			if (kept !== meaning.model) {
				for (const table of VECTOR_TABLES) sqlite.run(`DELETE FROM ${table}`);
				sqlite
					.query(
						"INSERT INTO meta (key, value) VALUES ('model', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
					)
					.run(meaning.model);
			}
		}
		sqlite.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		return sqlite;
	}

	/** Forgets what belongs to the open index file. */
	function forget(): void {
		stores.clear();
		synced.clear();
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
		forget();
		try {
			db = create();
		} catch {
			discard();
			db = create();
		}
		closed = false;
		return db;
	}

	/** The project's vector store on `sqlite`. */
	function storeOf(
		sqlite: Database,
		projectId: string,
		model: KnowledgeMeaning,
	): BunSqliteVectorStore {
		let store = stores.get(projectId);
		if (!store) {
			store = new BunSqliteVectorStore(model.embeddings, sqlite, projectId);
			stores.set(projectId, store);
		}
		return store;
	}

	/** Whether the model can embed now. A change is logged once. */
	async function readyNow(model: KnowledgeMeaning) {
		const ready = await model.ready();
		if (ready !== lastReady && (lastReady !== null || ready !== "ready")) {
			console.info(
				ready === "ready"
					? `Knowledge search finds by meaning again, with ${model.model}.`
					: ready === "no-model"
						? `Knowledge search finds by words only: Ollama does not have ${model.model}. Run: ollama pull ${model.model}`
						: "Knowledge search finds by words only: Ollama does not answer on this computer.",
			);
		}
		lastReady = ready;
		return ready;
	}

	/** The project's sections changed: its vectors are behind. */
	function stale(projectId: string): void {
		synced.delete(projectId);
		generation.set(projectId, (generation.get(projectId) ?? 0) + 1);
	}

	/**
	 * Brings the project's vectors in step with its sections, in the
	 * background, one project at a time. A search never waits for it: it
	 * uses the vectors there are.
	 */
	function prepare(projectId: string): void {
		if (!meaning || closed) return;
		if (synced.has(projectId) || queued.has(projectId)) return;
		if (turnedOff.has(projectId)) return;
		const failed = failedAt.get(projectId);
		if (failed !== undefined && Date.now() - failed < RETRY_MS) return;
		queued.add(projectId);
		preparing = preparing.then(async () => {
			let again = false;
			try {
				again = await embed(projectId, meaning);
				failedAt.delete(projectId);
			} catch (error) {
				failedAt.set(projectId, Date.now());
				if (!closed) {
					console.warn(
						"Knowledge search could not prepare its search by meaning:",
						error,
					);
				}
			} finally {
				queued.delete(projectId);
			}
			if (again) prepare(projectId);
		});
	}

	/**
	 * Embeds the sections that have no vector yet and drops the vectors of
	 * sections that went, through `index()`. Every section goes in, with
	 * `cleanup: "full"`: a removed file is not seen, and only `full`
	 * removes what was not seen. An unchanged section costs a hash and a
	 * look-up, no embedding. True when the sections changed meanwhile.
	 */
	async function embed(
		projectId: string,
		model: KnowledgeMeaning,
	): Promise<boolean> {
		// Closed meanwhile: a preparation does not open the index again.
		if ((await readyNow(model)) !== "ready" || closed) return false;
		const at = generation.get(projectId) ?? 0;
		const sqlite = await database();
		const docs = sqlite
			.query<{ path: string; title: string; text: string }, [string]>(
				`SELECT f.path AS path, f.title AS title, s.text AS text
				FROM sections s JOIN files f ON f.id = s.file_id
				WHERE f.project_id = ? AND s.text != ''
				ORDER BY f.path, s.ord`,
			)
			.all(projectId)
			.map(
				(row) =>
					new Document({
						pageContent: embedText(row.title, row.text),
						// Only the path: a line or heading that moves does not embed a section again.
						metadata: { path: row.path },
					}),
			);
		await index({
			docsSource: docs,
			recordManager: new BunSqliteRecordManager(
				sqlite,
				`knowledge:${projectId}`,
			),
			vectorStore: storeOf(sqlite, projectId, model),
			options: {
				cleanup: "full",
				sourceIdKey: "path",
				batchSize: EMBED_BATCH,
			},
		});
		if ((generation.get(projectId) ?? 0) !== at) return true;
		synced.add(projectId);
		return false;
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
					"SELECT id, path, size, changed_at, sha256 FROM files WHERE project_id = ?",
				)
				.all(projectId)
				.map((row) => [row.path, row]),
		);
		const changed: { file: KnowledgeFile; row: Row | undefined }[] = [];
		for (const f of files) {
			const row = known.get(f.path);
			known.delete(f.path);
			if (!row || row.size !== f.size || row.changed_at !== f.changedAt) {
				changed.push({ file: f, row });
			}
		}
		const gone = [...known.values()];

		const dropFile = sqlite.prepare("DELETE FROM files WHERE id = ?");
		const dropTexts = sqlite.prepare(
			"DELETE FROM texts WHERE rowid IN (SELECT id FROM sections WHERE file_id = ?)",
		);
		const dropSections = sqlite.prepare(
			"DELETE FROM sections WHERE file_id = ?",
		);
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
			[number, number, string | null, number, number | null, string]
		>(
			"INSERT INTO sections (file_id, ord, heading, line, page, text) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
		);
		const addText = sqlite.prepare(
			"INSERT INTO texts (rowid, path, title, heading, body) VALUES (?, ?, ?, ?, ?)",
		);
		const drop = (id: number) => {
			dropTexts.run(id);
			dropSections.run(id);
		};

		let moved = false;
		if (gone.length > 0) {
			moved = true;
			sqlite.transaction(() => {
				for (const row of gone) {
					drop(row.id);
					dropFile.run(row.id);
				}
			})();
		}

		for (let at = 0; at < changed.length; at += BATCH) {
			const batch = await Promise.all(
				changed.slice(at, at + BATCH).map(async ({ file: f, row }) => {
					const abs = join(dir, ...f.path.split("/"));
					// A file that went since the walk is dropped by the next refresh.
					const sha256 = await sha256OfFile(abs).catch(() => "");
					if (row && sha256 !== "" && row.sha256 === sha256) {
						return { file: f, row, same: true as const };
					}
					const fallback = fallbackTitle(f.path);
					let title = f.path.split("/").at(-1) ?? f.path;
					let content: string | Document[] = "";
					if (isDocument(f.path)) {
						const docs = await loadDocument(abs);
						if (docs !== null) {
							title = describeDocument(docs, fallback).title;
							content = firstPages(docs, MAX_BODY_BYTES);
						}
					} else {
						const read = await readStart(abs, MAX_BODY_BYTES);
						content = read?.text ?? "";
						title = describeText(content.slice(0, 4096), fallback).title;
					}
					const sections = await splitSections(f.path, content);
					return {
						file: f,
						row,
						same: false as const,
						sha256,
						title,
						sections,
					};
				}),
			);
			sqlite.transaction(() => {
				for (const item of batch) {
					const { file: f, row } = item;
					if (item.same) {
						touchFile.run(f.size, f.changedAt, row?.id ?? 0);
						continue;
					}
					moved = true;
					let id = row?.id;
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
						drop(id);
					}
					for (const [ord, section] of item.sections.entries()) {
						const { heading, line, page } = section.metadata as SectionMetadata;
						const added = addSection.get(
							id,
							ord,
							heading,
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
		}
		if (moved) stale(projectId);
		return {
			files: files.length,
			indexed: changed.length,
			removed: gone.length,
		};
	}

	/**
	 * The project's index brought up to date with its folder, then its
	 * vectors in the background, unless search by meaning is off for it.
	 */
	function refresh(projectId: string): Promise<KnowledgeRefresh> {
		const running = refreshing.get(projectId);
		if (running) return running;
		const next = Promise.all([update(projectId), readSetting(projectId)])
			.then(([result, on]) => {
				if (on) prepare(projectId);
				return result;
			})
			.finally(() => refreshing.delete(projectId));
		refreshing.set(projectId, next);
		return next;
	}

	/** The files whose sections have the words, best section first, at most `limit`. */
	function byWords(
		sqlite: Database,
		projectId: string,
		match: string,
		limit: number,
	): WordsHit[] {
		// Columns: path, title, heading, body. A word in the title counts most, then the path, then a heading.
		const rows = sqlite
			.query<
				{
					path: string;
					title: string;
					heading: string | null;
					line: number;
					page: number | null;
					snippet: string;
				},
				[string, string, number]
			>(
				`SELECT f.path AS path, f.title AS title, s.heading AS heading, s.line AS line, s.page AS page,
					snippet(texts, -1, '${OPEN}', '${CLOSE}', '…', ${SNIPPET_TOKENS}) AS snippet
				FROM texts t JOIN sections s ON s.id = t.rowid JOIN files f ON f.id = s.file_id
				WHERE texts MATCH ? AND f.project_id = ?
				ORDER BY bm25(texts, 3.0, 5.0, 2.0, 1.0) LIMIT ?`,
			)
			.all(match, projectId, SECTION_CANDIDATES);
		const out: WordsHit[] = [];
		const seen = new Set<string>();
		for (const row of rows) {
			if (seen.has(row.path)) continue;
			seen.add(row.path);
			out.push({
				path: row.path,
				title: row.title,
				heading: row.heading,
				line: row.line,
				page: row.page,
				snippet: snippetParts(row.snippet),
			});
			if (out.length >= limit) break;
		}
		return out;
	}

	/**
	 * The files whose sections are closest to the query in meaning, best
	 * first, at most `limit`. None when the model cannot embed now, the
	 * project has no vectors yet, or the query's vector does not come.
	 */
	async function byMeaning(
		sqlite: Database,
		projectId: string,
		text: string,
		limit: number,
	): Promise<MeaningHit[]> {
		if (!meaning || (await readyNow(meaning)) !== "ready") return [];
		const store = storeOf(sqlite, projectId, meaning);
		if (store.count() === 0) return [];
		let vector: number[];
		try {
			vector = await within(
				meaning.embeddings.embedQuery(meaning.query(text)),
				QUERY_TIMEOUT_MS,
			);
			queryFailed = false;
		} catch (error) {
			if (!queryFailed) {
				console.warn(
					"Knowledge search finds by words only: the query's vector did not come.",
					error,
				);
			}
			queryFailed = true;
			return [];
		}
		const found = await store.similaritySearchVectorWithScore(
			vector,
			SECTION_CANDIDATES,
		);
		const files = new Map(
			sqlite
				.query<{ id: number; path: string; title: string }, [string]>(
					"SELECT id, path, title FROM files WHERE project_id = ?",
				)
				.all(projectId)
				.map((row) => [row.path, row]),
		);
		const sectionsOf = sqlite.prepare<
			{
				heading: string | null;
				line: number;
				page: number | null;
				text: string;
			},
			[number]
		>(
			"SELECT heading, line, page, text FROM sections WHERE file_id = ? ORDER BY ord",
		);
		const out: MeaningHit[] = [];
		const seen = new Set<string>();
		for (const [doc, similarity] of found) {
			const path = String(doc.metadata.path ?? "");
			const f = files.get(path);
			// A vector of a file that went waits for the next preparation to go.
			if (!f || seen.has(path)) continue;
			seen.add(path);
			const section = sectionsOf
				.all(f.id)
				.find((s) => embedText(f.title, s.text) === doc.pageContent);
			out.push({
				similarity,
				path,
				title: f.title,
				heading: section?.heading ?? null,
				line: section?.line ?? 1,
				page: section?.page ?? null,
				snippet: sectionStart(
					section?.text ?? doc.pageContent.slice(f.title.length + 2),
				),
			});
			if (out.length >= limit) break;
		}
		return out;
	}

	return {
		refresh,
		/**
		 * The files of the project's knowledge that best match `text`, best
		 * first, after a refresh, each at its best section. By words: every
		 * word must match, and when no section has them all, sections with
		 * some of them. By meaning too, when this computer can: both lists
		 * are fused by reciprocal rank. No input makes it throw.
		 */
		async search(
			projectId: string,
			text: string,
			options: { limit?: number; mode?: KnowledgeSearchMode } = {},
		): Promise<KnowledgeHit[]> {
			const limit = Math.min(
				Math.max(1, Math.floor(options.limit ?? LIMIT_DEFAULT)),
				LIMIT_MAX,
			);
			const mode = options.mode ?? "both";
			const all = matchQuery(text, "all");
			if (all === null) return [];
			const depth = Math.max(limit, FUSE_DEPTH);
			const on = mode !== "words" && (await readSetting(projectId));
			return healing(async () => {
				await refresh(projectId);
				const sqlite = await database();
				let words: WordsHit[] = [];
				if (mode !== "meaning") {
					words = byWords(sqlite, projectId, all, depth);
					if (words.length === 0) {
						const any = matchQuery(text, "any");
						if (any !== null && any !== all) {
							words = byWords(sqlite, projectId, any, depth);
						}
					}
				}
				const meant = on
					? await byMeaning(sqlite, projectId, text.trim(), depth)
					: [];
				const byPath = {
					words: new Map(words.map((hit) => [hit.path, hit])),
					meaning: new Map(meant.map((hit) => [hit.path, hit])),
				};
				// A file only the meaning found must be close enough to the query.
				const floor = meaning?.floor ?? 0;
				const close = (path: string) =>
					byPath.words.has(path) ||
					(byPath.meaning.get(path)?.similarity ?? 0) >= floor;
				return fuseRanks([
					words.map((hit) => hit.path),
					meant.map((hit) => hit.path),
				])
					.filter(({ key }) => close(key))
					.slice(0, limit)
					.flatMap(({ key, score }) => {
						const word = byPath.words.get(key);
						const meanHit = byPath.meaning.get(key);
						const best = word ?? meanHit;
						if (!best) return [];
						const found: KnowledgeFound[] = [];
						if (word) found.push("words");
						if (meanHit) found.push("meaning");
						return [
							{
								path: best.path,
								title: best.title,
								section: best.heading,
								line: best.line,
								page: best.page,
								snippet: best.snippet,
								score,
								found,
							},
						];
					});
			});
		},
		/**
		 * Whether search by meaning works for the project on this computer,
		 * after a refresh. Starts the preparation of its vectors when they
		 * are behind.
		 */
		async meaning(projectId: string): Promise<KnowledgeMeaningStatus> {
			if (!meaning) return { state: "off", model: null, done: 0, total: 0 };
			if (!(await readSetting(projectId))) {
				return { state: "turned-off", model: meaning.model, done: 0, total: 0 };
			}
			const ready = await readyNow(meaning);
			if (ready !== "ready") {
				return { state: ready, model: meaning.model, done: 0, total: 0 };
			}
			return healing(async () => {
				await refresh(projectId);
				const sqlite = await database();
				const total =
					sqlite
						.query<{ n: number }, [string]>(
							"SELECT count(*) AS n FROM sections s JOIN files f ON f.id = s.file_id WHERE f.project_id = ? AND s.text != ''",
						)
						.get(projectId)?.n ?? 0;
				if (synced.has(projectId)) {
					return { state: "on", model: meaning.model, done: total, total };
				}
				prepare(projectId);
				const done = Math.min(
					storeOf(sqlite, projectId, meaning).count(),
					total,
				);
				return { state: "preparing", model: meaning.model, done, total };
			});
		},
		/** Closes the index file. A later call opens it again. */
		close(): void {
			closed = true;
			db?.close();
			db = null;
			forget();
		},
	};
}
