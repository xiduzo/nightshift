import { createHash } from "node:crypto";

/**
 * The sections of a knowledge file: the parts that search finds, by
 * their words and by their meaning, so a hit points at a part of a file
 * and not at the whole of it.
 *
 * A splitter (`SectionSplitter`) cuts the text. Markdown is cut at its
 * headings first, then at code fences, paragraphs and lines. Other text is
 * cut at paragraphs and lines. The headings of a section are the ones open
 * at the line where it starts: the last heading at or above that line, and
 * the headings above it, one per level. A section's place in its file is
 * what the embedding model reads besides its text: "Limits" alone says
 * little, its heading path says whose.
 */

/** What a section knows of where it is in its file. */
export type SectionMetadata = {
	/** The file's path in the knowledge. */
	path: string;
	/** The heading the section is under, without its `#` marks. Null: none above it. */
	heading: string | null;
	/** Its headings from the top of the file to `heading`, joined by ` › `. Empty: none above it. */
	headingPath: string;
	/** The line where the section starts, from 1: of the file, or of its page. */
	line: number;
	/** The page of a PDF the section is on, from 1. Null: the file has no pages. */
	page: number | null;
};

/** A section of a file as a splitter gives it: its text and its place. */
export type SplitSection = { pageContent: string; metadata: SectionMetadata };

/** A page of a PDF or Word file, as its loader gives it. */
export type SectionPage = {
	pageContent: string;
	metadata: { title?: string; loc?: { pageNumber: number } };
};

/** A section as the search index keeps it: `id` is what its vector knows (`sectionId`). */
type IndexedSection = {
	id: string;
	heading: string | null;
	headingPath: string;
	line: number;
	page: number | null;
	text: string;
};

const PATH_SEPARATOR = " › ";
const MARKDOWN = new Set([".md", ".markdown", ".mdx"]);

/**
 * What the embedding model reads of a section: the file's title, the headings
 * above it, then the section. A heading the text already says does not come
 * twice: a file's first heading is often its title, and a section often starts
 * with its own heading. Measured on this repository's docs, repeating it found
 * the same files, at lower ranks (`docs/knowledge.md`, "Measure the search").
 */
export function embedText(
	title: string,
	headingPath: string,
	text: string,
): string {
	const headings = headingPath === "" ? [] : headingPath.split(PATH_SEPARATOR);
	if (headings.at(-1) === firstLineHeading(text)) headings.pop();
	if (headings[0] === title) headings.shift();
	return `${[title, ...headings].join(PATH_SEPARATOR)}\n\n${text}`;
}

/** The heading a text starts with, if it does. */
const firstLineHeading = (text: string) =>
	markdownHeadings(text.slice(0, text.indexOf("\n") + 1 || undefined))[0]?.text;

/**
 * The id of a section: a hash of its path and of what the model reads, and
 * nothing about where it stands. `index()` hashes a vector's metadata into its
 * record, so an id that changes when a section moves (a row id, a position)
 * would embed every section of a file at each edit, at real Ollama time. With
 * this one a section gets a new vector exactly when its path or its embedded
 * text changes. Two sections with the same text in one file share an id and a
 * vector, and a hit goes to the first.
 */
export function sectionId(
	path: string,
	title: string,
	headingPath: string,
	text: string,
): string {
	return createHash("sha256")
		.update(path)
		.update("\0")
		.update(embedText(title, headingPath, text))
		.digest("hex");
}

/** The sections of a file as the search index keeps them, each with its id. */
export function indexedSections(
	path: string,
	title: string,
	sections: readonly SplitSection[],
): IndexedSection[] {
	return sections.map(({ pageContent: text, metadata }) => ({
		id: sectionId(path, title, metadata.headingPath, text),
		heading: metadata.heading,
		headingPath: metadata.headingPath,
		line: metadata.line,
		page: metadata.page,
		text,
	}));
}

/** The extension of a path's file name, with its dot, as `node:path` gives it. */
function extensionOf(path: string): string {
	const name = path.split("/").at(-1) ?? path;
	const dot = name.lastIndexOf(".");
	return dot <= 0 || name === ".." ? "" : name.slice(dot);
}

/** Whether a path is a markdown file: the only files with headings. */
export const isMarkdown = (path: string) =>
	MARKDOWN.has(extensionOf(path).toLowerCase());

/** A heading of a markdown text. */
type MarkdownHeading = {
	/** 1 for `#`, up to 6. */
	level: number;
	/** Without its `#` marks. */
	text: string;
	/** Its line, from 1. */
	line: number;
};

/**
 * The headings of a markdown text, in order: `#` lines, not in the front
 * matter and not in code fences. The one parser of headings, for a section's
 * place and for the file's lines in `INDEX.md`.
 */
export function markdownHeadings(text: string): MarkdownHeading[] {
	const out: MarkdownHeading[] = [];
	const lines = text.split("\n");
	const frontMatterEnd =
		lines[0]?.trimEnd() === "---"
			? lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---")
			: -1;
	let fence: string | null = null;
	for (const [i, raw] of lines.entries()) {
		if (i <= frontMatterEnd) continue;
		const line = raw.trimEnd();
		const opens = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (opens?.[1]?.startsWith(fence)) fence = null;
		} else if (opens?.[1]) {
			fence = opens[1].slice(0, 3);
		} else {
			const heading = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
			if (heading?.[1] && heading[2]) {
				out.push({
					level: heading[1].length,
					text: heading[2].trim(),
					line: i + 1,
				});
			}
		}
	}
	return out;
}

/** For each line of a markdown text, from 0: the headings open there, the top one first. */
export function headingsByLine(text: string): string[][] {
	const at = new Map(markdownHeadings(text).map((h) => [h.line, h]));
	const open: MarkdownHeading[] = [];
	let current: string[] = [];
	return text.split("\n").map((_, i) => {
		const heading = at.get(i + 1);
		if (heading) {
			while ((open.at(-1)?.level ?? 0) >= heading.level) open.pop();
			open.push(heading);
			current = open.map((h) => h.text);
		}
		return current;
	});
}

/**
 * The texts a file's sections are cut from, with their page: the file's
 * text, or each page a document loader gave. Lines end in `\n`. A page with
 * no text is left out.
 */
export function pagesOf(
	content: string | readonly SectionPage[],
): { text: string; page: number | null }[] {
	const pages: readonly SectionPage[] =
		typeof content === "string"
			? [{ pageContent: content, metadata: {} }]
			: content;
	return pages
		.map((doc) => ({
			text: doc.pageContent.replace(/\r\n?/g, "\n"),
			page:
				typeof content === "string"
					? null
					: (doc.metadata.loc?.pageNumber ?? null),
		}))
		.filter((page) => page.text.trim() !== "");
}

/** The one section of a file with no text, so its path and title still find it. */
export function emptySection(path: string): SplitSection {
	return {
		pageContent: "",
		metadata: { path, heading: null, headingPath: "", line: 1, page: null },
	};
}

/**
 * A section cut from a page at `line`, under the headings open there.
 * `headings`: of each line of the page (`headingsByLine`), none for a text
 * that is not markdown.
 */
export function placedSection(
	path: string,
	text: string,
	at: { line: number; page: number | null },
	headings: readonly string[][],
): SplitSection {
	const open = headings[at.line - 1] ?? [];
	return {
		pageContent: text,
		metadata: {
			path,
			heading: open.at(-1) ?? null,
			headingPath: open.join(PATH_SEPARATOR),
			line: at.line,
			page: at.page,
		},
	};
}
