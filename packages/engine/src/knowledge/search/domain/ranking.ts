/**
 * How a search ranks: the query a person or an agent typed as words to
 * match, the excerpt of a hit, and the fusion of the files the words found
 * with the ones the meaning found, by reciprocal rank. A file found by
 * meaning alone must pass the model's floor: a query no file matches finds
 * nothing.
 */

/** A part of a hit's excerpt: `match` parts are the words the query found. */
type KnowledgeSnippetPart = { text: string; match: boolean };

/** How a search found a file: by the words of the query, or by its meaning. */
type KnowledgeFound = "words" | "meaning";

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
 * fused (the default). The evaluation (`evaluation.ts`) compares them.
 */
export type KnowledgeSearchMode = "words" | "meaning" | "both";

/** A file the words found, at its best section. */
export type WordsHit = {
	path: string;
	title: string;
	heading: string | null;
	line: number;
	page: number | null;
	snippet: KnowledgeSnippetPart[];
};

/** A file the meaning found, at its best section. */
export type MeaningHit = WordsHit & {
	/** How similar its best section is to the query (cosine). */
	similarity: number;
};

/** Hits a search returns by default, and at most. */
const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 50;
/** Files each list gives to the fusion, at least. */
const FUSE_DEPTH = 20;
/** Sections each list reads to find its best files. */
export const SECTION_CANDIDATES = 200;
/** Reciprocal rank fusion's constant: a file at rank r of a list adds 1 / (60 + r). */
const RRF_C = 60;
/** Characters of a section's start, as the excerpt of a hit found by meaning only. */
const SNIPPET_CHARS = 180;

/**
 * Mark a match in a section's excerpt, as the search index writes them
 * (`MATCH_OPEN` and `MATCH_CLOSE` of `search-index`): never in a text file.
 */
const MATCH_OPEN = "\u0002";
const MATCH_CLOSE = "\u0003";

/** How many hits a search gives: the limit asked, from 1 to 50. 10 by default. */
export function hitLimit(limit: number | undefined): number {
	return Math.min(Math.max(1, Math.floor(limit ?? LIMIT_DEFAULT)), LIMIT_MAX);
}

/** How many files each list gives to the fusion, for a search of `limit` hits. */
export const fuseDepth = (limit: number) => Math.max(limit, FUSE_DEPTH);

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
export function sectionStart(text: string): KnowledgeSnippetPart[] {
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
export function snippetParts(raw: string): KnowledgeSnippetPart[] {
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

/**
 * The hits of a search: the files of both lists fused by reciprocal rank,
 * best first, at most `limit`, each at its best section (the words' first).
 * A file only the meaning found must be at `floor` or closer to the query.
 * `keep`: the files a search may give, once more, whatever the lists did.
 */
export function fuseHits(options: {
	words: readonly WordsHit[];
	meant: readonly MeaningHit[];
	floor: number;
	limit: number;
	keep: (path: string) => boolean;
}): KnowledgeHit[] {
	const { words, meant, floor, limit, keep } = options;
	const byPath = {
		words: new Map(words.map((hit) => [hit.path, hit])),
		meaning: new Map(meant.map((hit) => [hit.path, hit])),
	};
	// A file only the meaning found must be close enough to the query.
	const close = (path: string) =>
		byPath.words.has(path) ||
		(byPath.meaning.get(path)?.similarity ?? 0) >= floor;
	return fuseRanks([words.map((hit) => hit.path), meant.map((hit) => hit.path)])
		.filter(({ key }) => close(key))
		.filter(({ key }) => keep(key))
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
}
