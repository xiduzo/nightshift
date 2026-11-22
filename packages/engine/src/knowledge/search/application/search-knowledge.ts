import { inFolders } from "../../files";
import {
	fuseDepth,
	fuseHits,
	hitLimit,
	type KnowledgeHit,
	type KnowledgeSearchMode,
	type MeaningHit,
	matchQuery,
	SECTION_CANDIDATES,
	sectionStart,
	snippetParts,
	type WordsHit,
} from "../domain/ranking";
import { readinessOf, type VectorStates } from "../domain/vector-states";
import type { MeaningModel, SearchIndex } from "./ports";
import type { KnowledgeRefresh } from "./refresh-search-index";

export type SearchKnowledgePorts = {
	index: Pick<
		SearchIndex,
		"healing" | "sectionsWithWords" | "vectorsFor" | "fileAt" | "section"
	>;
	meaning: MeaningModel;
	/** Whether a person left search by meaning on for the project. Never throws. */
	meaningOn(projectId: string): Promise<boolean>;
	/** The project's index brought up to date first (`refreshSearchIndex`). */
	refresh(request: { projectId: string }): Promise<KnowledgeRefresh>;
	states: Pick<VectorStates, "heardReady">;
	/** Whether the last query's vector did not come, to log it once. */
	queries: { failed: boolean };
};

/**
 * What to find in a project's knowledge. `limit`: hits at most, 10 by
 * default, 50 at most. `mode`: by words, by meaning, or both (the default).
 * `folders`: files in those folders only (`inFolders`), as a step with a view
 * of the knowledge searches.
 */
export type SearchKnowledge = {
	projectId: string;
	text: string;
	limit?: number;
	mode?: KnowledgeSearchMode;
	folders?: readonly string[];
};

/** How long a search waits for the query's vector before it finds by words only. A Host's CPU takes 3 s for one, and up to 8 s more while a preparation runs. */
const QUERY_TIMEOUT_MS = 15_000;

/**
 * Finds the files of a project's knowledge that best match a query, best
 * first, after a refresh, each at its best section. By words: an FTS5 table
 * of the sections, ranked by BM25. Every word must match, and when no
 * section has them all, sections with some of them. By meaning too, when
 * this computer can: a vector per section, kept current in the background,
 * never during a search. Both lists are fused by reciprocal rank. Without
 * Ollama, or before the first vectors, it finds by words only. No input
 * makes it throw.
 */
export const searchKnowledge =
	(ports: SearchKnowledgePorts) =>
	async (request: SearchKnowledge): Promise<KnowledgeHit[]> => {
		const { projectId, text, folders } = request;
		const limit = hitLimit(request.limit);
		const mode = request.mode ?? "both";
		const all = matchQuery(text, "all");
		if (all === null) return [];
		const depth = fuseDepth(limit);
		const on = mode !== "words" && (await ports.meaningOn(projectId));
		return ports.index.healing(async () => {
			await ports.refresh({ projectId });
			let words: WordsHit[] = [];
			if (mode !== "meaning") {
				words = byWords(ports, projectId, all, depth, folders);
				if (words.length === 0) {
					const any = matchQuery(text, "any");
					if (any !== null && any !== all) {
						words = byWords(ports, projectId, any, depth, folders);
					}
				}
			}
			const meant = on
				? await byMeaning(ports, projectId, text.trim(), depth, folders)
				: [];
			return fuseHits({
				words,
				meant,
				floor: ports.meaning.current()?.floor ?? 0,
				limit,
				// Once more, whatever the lists did.
				keep: (path) => !folders || inFolders(path, folders),
			});
		});
	};

/**
 * The files whose sections have the words, best section first, at most
 * `limit`. With `folders`: in those folders only (`inFolders`).
 */
function byWords(
	ports: SearchKnowledgePorts,
	projectId: string,
	match: string,
	limit: number,
	folders?: readonly string[],
): WordsHit[] {
	const rows = ports.index.sectionsWithWords(
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
	ports: SearchKnowledgePorts,
	projectId: string,
	text: string,
	limit: number,
	folders?: readonly string[],
): Promise<MeaningHit[]> {
	const { index } = ports;
	const meaning = ports.meaning.current();
	if (
		!meaning ||
		(await readinessOf(meaning, ports.states, console.info)) !== "ready"
	) {
		return [];
	}
	const vectors = index.vectorsFor(projectId, meaning);
	if (vectors.count() === 0) return [];
	let vector: number[];
	try {
		vector = await within(
			meaning.embeddings.embedQuery(meaning.query(text)),
			QUERY_TIMEOUT_MS,
		);
		ports.queries.failed = false;
	} catch (error) {
		if (!ports.queries.failed) {
			console.warn(
				"Knowledge search finds by words only: the query's vector did not come.",
				error,
			);
		}
		ports.queries.failed = true;
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
		const f = index.fileAt(projectId, path);
		// A vector of a file that went waits for the next preparation to go.
		if (!f) continue;
		seen.add(path);
		// None: the file changed since this vector, which the next preparation drops.
		const section = index.section(f.id, String(doc.metadata.section_id));
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
