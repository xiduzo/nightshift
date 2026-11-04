import { extname, join } from "node:path";
import { Document } from "@langchain/core/documents";
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
import {
	createSearchStore,
	type IndexedFile,
	type IndexedFileWrite,
	MATCH_CLOSE,
	MATCH_OPEN,
} from "./search-store";
import { splitSections } from "./sections";
import {
	createVectorPreparation,
	type VectorPreparationEvent,
} from "./vector-preparation";
import { inFolders } from "./view";

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
 * background (`vector-preparation.ts`), never during a search. The tables
 * are the store's (`search-store.ts`): this module is the refresh and the
 * query. A search fuses both lists by file with reciprocal rank fusion.
 * A file found by meaning alone must pass the model's floor
 * (`KnowledgeMeaning.floor`): a query no file matches finds nothing.
 * Without Ollama, or before the first vectors, it finds by words only.
 *
 * It indexes the text files (`TEXT_FILES`) the index lists, and the text
 * of PDF and Word files (`documents.ts`): the files a person or an agent
 * reads (`isReadable`), so not `INDEX.md`, hidden files or the learnings
 * that wait for a person. A document over 10 MB is found by its path only.
 * Reading one file is `KnowledgeReader.read`.
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
 * not have the model. `downloading`: the model is on its way, `percent` of
 * it. `preparing`: the first vectors are on their way, `done` of `total`
 * sections. `failed`: the last preparation stopped at `done` of `total`, and
 * it tries again. `on`: every section has its vector.
 */
export type KnowledgeMeaningStatus = {
	state:
		| "off"
		| "turned-off"
		| Exclude<KnowledgeMeaningReady, "ready">
		| "preparing"
		| "failed"
		| "on";
	/** The embedding model. Null when it is off. */
	model: string | null;
	done: number;
	total: number;
	/** Where the model runs: null on this computer, else the host name of its Ollama. */
	where: string | null;
	/** While `downloading`: how far the download of the model is, in percent. */
	percent: number | null;
};

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
/** Characters of a section's start, as the excerpt of a hit found by meaning only. */
const SNIPPET_CHARS = 180;
/** How long a search waits for the query's vector before it finds by words only. A Host's CPU takes 3 s for one, and up to 8 s more while a preparation runs. */
const QUERY_TIMEOUT_MS = 15_000;

const isText = (path: string) => TEXT_FILES.has(extname(path).toLowerCase());
/** The files the index reads: text files and documents. */
const isIndexed = (path: string) => isText(path) || isDocument(path);

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
		const start = rest.indexOf(MATCH_OPEN);
		if (start < 0) {
			push(rest, false);
			break;
		}
		push(rest.slice(0, start), false);
		const end = rest.indexOf(MATCH_CLOSE, start);
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
 * `meaning`: the embedding model for search by meaning, or a function that
 * gives the one to use now (the model or Ollama's address can change while
 * Night Shift runs: another model builds the vectors again). Without it, or
 * when it gives null, search finds by words only. `meaningOn`: whether a
 * person left search by meaning on for a project (the project's setting,
 * `knowledge-document.ts`). Off: the project is searched by words only,
 * and its vectors are not prepared. Default: on. `clock` and `onPreparation`:
 * the vector preparation's clock, and what hears each change of its state.
 */
export function createKnowledgeSearch(
	dataDir: string,
	options: {
		meaning?: KnowledgeMeaning | (() => KnowledgeMeaning | null);
		meaningOn?: (projectId: string) => Promise<boolean>;
		clock?: () => number;
		onPreparation?: (event: VectorPreparationEvent) => void;
	} = {},
) {
	const given = options.meaning;
	/** The embedding model now. Null: search by meaning is off. */
	const current = (): KnowledgeMeaning | null =>
		typeof given === "function" ? given() : (given ?? null);
	/** Whether search by meaning is on for the project: a setting that cannot be read leaves it on. */
	const meaningOn = (projectId: string): Promise<boolean> =>
		options.meaningOn
			? options.meaningOn(projectId).catch(() => true)
			: Promise.resolve(true);
	const folders = createKnowledgeFolders(dataDir);
	const store = createSearchStore(dataDir, {
		onVectorsGone: () => preparation.vectorsGone(),
	});
	/** Closed for good: a later search still answers, and nothing prepares. */
	let closed = false;
	const preparation = createVectorPreparation({
		store,
		model: () => (closed ? null : current()),
		meaningOn,
		...(options.clock ? { clock: options.clock } : {}),
		...(options.onPreparation ? { onEvent: options.onPreparation } : {}),
	});
	/** One refresh per project at a time: a second search waits for it. */
	const refreshing = new Map<string, Promise<KnowledgeRefresh>>();
	/** Whether the last query's vector did not come, to log it once. */
	let queryFailed = false;

	async function update(projectId: string): Promise<KnowledgeRefresh> {
		const dir = folders.folder(projectId);
		const files = (await folders.files(projectId)).filter((f) =>
			isIndexed(f.path),
		);
		await store.open();
		const known = store.files(projectId);
		const changed: { file: KnowledgeFile; row: IndexedFile | undefined }[] = [];
		for (const f of files) {
			const row = known.get(f.path);
			known.delete(f.path);
			if (!row || row.size !== f.size || row.changed_at !== f.changedAt) {
				changed.push({ file: f, row });
			}
		}
		const gone = [...known.values()];

		let moved = false;
		if (gone.length > 0) {
			moved = true;
			store.removeFiles(gone);
		}

		for (let at = 0; at < changed.length; at += BATCH) {
			const batch = await Promise.all(
				changed
					.slice(at, at + BATCH)
					.map(async ({ file: f, row }): Promise<IndexedFileWrite> => {
						const abs = join(dir, ...f.path.split("/"));
						// A file that went since the walk is dropped by the next refresh.
						const sha256 = await sha256OfFile(abs).catch(() => "");
						if (row && sha256 !== "" && row.sha256 === sha256) {
							return { file: f, row, same: true };
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
						return { file: f, row, same: false, sha256, title, sections };
					}),
			);
			if (store.writeFiles(projectId, batch)) moved = true;
		}
		if (moved) preparation.sectionsChanged(projectId);
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
		const next = update(projectId)
			.then((result) => {
				preparation.request(projectId);
				return result;
			})
			.finally(() => refreshing.delete(projectId));
		refreshing.set(projectId, next);
		return next;
	}

	/**
	 * The files whose sections have the words, best section first, at most
	 * `limit`. With `folders`: in those folders only (`inFolders`).
	 */
	function byWords(
		projectId: string,
		match: string,
		limit: number,
		folders?: readonly string[],
	): WordsHit[] {
		const rows = store.sectionsWithWords(
			projectId,
			match,
			SECTION_CANDIDATES,
			folders,
		);
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
		projectId: string,
		text: string,
		limit: number,
		folders?: readonly string[],
	): Promise<MeaningHit[]> {
		const meaning = current();
		if (!meaning || (await preparation.readiness(meaning)) !== "ready") {
			return [];
		}
		const vectors = store.vectorsFor(projectId, meaning);
		if (vectors.count() === 0) return [];
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
		const found = await vectors.similaritySearchVectorWithScore(
			vector,
			SECTION_CANDIDATES,
			// Before the candidates are counted, so other files take no place.
			folders
				? (doc) => inFolders(String(doc.metadata.path ?? ""), folders)
				: undefined,
		);
		const out: MeaningHit[] = [];
		const seen = new Set<string>();
		for (const [doc, similarity] of found) {
			const path = String(doc.metadata.path ?? "");
			if (seen.has(path)) continue;
			const f = store.fileAt(projectId, path);
			// A vector of a file that went waits for the next preparation to go.
			if (!f) continue;
			seen.add(path);
			// None: the file changed since this vector, which the next preparation drops.
			const section = store.section(f.id, String(doc.metadata.section_id));
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
		 * are fused by reciprocal rank. With `folders`: files in those folders
		 * only (`inFolders`), as a step with a view of the knowledge searches.
		 * No input makes it throw.
		 */
		async search(
			projectId: string,
			text: string,
			options: {
				limit?: number;
				mode?: KnowledgeSearchMode;
				folders?: readonly string[];
			} = {},
		): Promise<KnowledgeHit[]> {
			const limit = Math.min(
				Math.max(1, Math.floor(options.limit ?? LIMIT_DEFAULT)),
				LIMIT_MAX,
			);
			const mode = options.mode ?? "both";
			const all = matchQuery(text, "all");
			if (all === null) return [];
			const depth = Math.max(limit, FUSE_DEPTH);
			const on = mode !== "words" && (await meaningOn(projectId));
			return store.healing(async () => {
				await refresh(projectId);
				let words: WordsHit[] = [];
				const { folders } = options;
				if (mode !== "meaning") {
					words = byWords(projectId, all, depth, folders);
					if (words.length === 0) {
						const any = matchQuery(text, "any");
						if (any !== null && any !== all) {
							words = byWords(projectId, any, depth, folders);
						}
					}
				}
				const meant = on
					? await byMeaning(projectId, text.trim(), depth, folders)
					: [];
				const byPath = {
					words: new Map(words.map((hit) => [hit.path, hit])),
					meaning: new Map(meant.map((hit) => [hit.path, hit])),
				};
				// A file only the meaning found must be close enough to the query.
				const floor = current()?.floor ?? 0;
				const close = (path: string) =>
					byPath.words.has(path) ||
					(byPath.meaning.get(path)?.similarity ?? 0) >= floor;
				return (
					fuseRanks([
						words.map((hit) => hit.path),
						meant.map((hit) => hit.path),
					])
						.filter(({ key }) => close(key))
						// Once more, whatever the lists did.
						.filter(({ key }) => !folders || inFolders(key, folders))
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
						})
				);
			});
		},
		/**
		 * Whether search by meaning works for the project on this computer,
		 * after a refresh. Starts the preparation of its vectors when they
		 * are behind.
		 */
		async meaning(projectId: string): Promise<KnowledgeMeaningStatus> {
			const meaning = current();
			if (!meaning) {
				return {
					state: "off",
					model: null,
					done: 0,
					total: 0,
					where: null,
					percent: null,
				};
			}
			const where = meaning.where ?? null;
			if (!(await meaningOn(projectId))) {
				return {
					state: "turned-off",
					model: meaning.model,
					done: 0,
					total: 0,
					where,
					percent: null,
				};
			}
			const ready = await preparation.readiness(meaning);
			if (ready !== "ready") {
				return {
					state: ready,
					model: meaning.model,
					done: 0,
					total: 0,
					where,
					percent:
						ready === "downloading" ? (meaning.downloaded?.() ?? 0) : null,
				};
			}
			return store.healing(async () => {
				await refresh(projectId);
				const total = store.sectionCount(projectId);
				// Before the state is read: another model makes every project behind.
				const vectors = store.vectorsFor(projectId, meaning);
				if (preparation.stateOf(projectId) === "ready") {
					return {
						state: "on",
						model: meaning.model,
						done: total,
						total,
						where,
						percent: null,
					};
				}
				preparation.request(projectId);
				return {
					state:
						preparation.stateOf(projectId) === "failed"
							? "failed"
							: "preparing",
					model: meaning.model,
					done: Math.min(vectors.count(), total),
					total,
					where,
					percent: null,
				};
			});
		},
		/**
		 * Closes the index file and ends the preparations for good. A later
		 * search opens the file again, for a session that outlives this
		 * index, and prepares nothing.
		 */
		close(): void {
			closed = true;
			store.close();
		},
	};
}
