import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/**
 * The sections of a knowledge file: the parts that search finds, by
 * their words and by their meaning, so a hit points at a part of a file
 * and not at the whole of it.
 *
 * LangChain's `RecursiveCharacterTextSplitter` cuts the text. Markdown is
 * cut at its headings first (`## `, then `### ` and lower), then at code
 * fences, paragraphs and lines. Other text is cut at paragraphs and lines.
 * LangChain.js has no `MarkdownHeaderTextSplitter`, so the headings of a
 * section are the ones open at the line where it starts: the last heading
 * at or above that line, and the headings above it, one per level. A
 * section's place in its file is what the embedding model reads besides its
 * text: "Limits" alone says little, its heading path says whose.
 *
 * 1 200 characters with 150 of overlap: the vectors spike
 * (`docs/research/knowledge-vectors.md` §2.1) found fewer, larger sections
 * index two times faster and find more than sections of 600.
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

const PATH_SEPARATOR = " › ";

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

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MARKDOWN = new Set([".md", ".markdown", ".mdx"]);

const markdownSplitter = RecursiveCharacterTextSplitter.fromLanguage(
	"markdown",
	{ chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP },
);
const textSplitter = new RecursiveCharacterTextSplitter({
	chunkSize: CHUNK_SIZE,
	chunkOverlap: CHUNK_OVERLAP,
});

/** Whether a path is a markdown file: the only files with headings. */
export const isMarkdown = (path: string) =>
	MARKDOWN.has(extname(path).toLowerCase());

/** A heading of a markdown text. */
export type MarkdownHeading = {
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
function headingsByLine(text: string): string[][] {
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
 * The sections of a file, in order, as LangChain documents: of its text,
 * or of the pages a document loader gave (`documents.ts`), each section on
 * one page. A file with no text gets one empty section, so its path and
 * title still find it.
 */
export async function splitSections(
	path: string,
	content: string | Document[],
): Promise<Document<SectionMetadata>[]> {
	const markdown = isMarkdown(path);
	const pages = (
		typeof content === "string"
			? [new Document({ pageContent: content })]
			: content
	)
		.map((doc) => ({
			text: doc.pageContent.replace(/\r\n?/g, "\n"),
			page:
				typeof content === "string"
					? null
					: ((doc.metadata.loc as { pageNumber?: number } | undefined)
							?.pageNumber ?? null),
		}))
		.filter((page) => page.text.trim() !== "");
	if (pages.length === 0) {
		return [
			new Document({
				pageContent: "",
				metadata: { path, heading: null, headingPath: "", line: 1, page: null },
			}),
		];
	}
	const splitter = markdown ? markdownSplitter : textSplitter;
	const out: Document<SectionMetadata>[] = [];
	for (const { text, page } of pages) {
		const headings = markdown ? headingsByLine(text) : [];
		for (const piece of await splitter.createDocuments([text])) {
			const loc = piece.metadata.loc as
				| { lines?: { from?: number } }
				| undefined;
			const line = Math.max(1, loc?.lines?.from ?? 1);
			const open = headings[line - 1] ?? [];
			out.push(
				new Document({
					pageContent: piece.pageContent,
					metadata: {
						path,
						heading: open.at(-1) ?? null,
						headingPath: open.join(PATH_SEPARATOR),
						line,
						page,
					},
				}),
			);
		}
	}
	return out;
}
