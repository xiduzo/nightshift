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
 * LangChain.js has no `MarkdownHeaderTextSplitter`, so the heading of a
 * section is the last heading line at or above the line where it starts.
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
	/** The line where the section starts, from 1: of the file, or of its page. */
	line: number;
	/** The page of a PDF the section is on, from 1. Null: the file has no pages. */
	page: number | null;
};

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

/** For each line of a markdown text, from 0: the heading it is under. Not in code fences. */
function headingsByLine(text: string): (string | null)[] {
	const out: (string | null)[] = [];
	let current: string | null = null;
	let fence: string | null = null;
	for (const raw of text.split("\n")) {
		const line = raw.trimEnd();
		const opens = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (opens?.[1]?.startsWith(fence)) fence = null;
		} else if (opens?.[1]) {
			fence = opens[1].slice(0, 3);
		} else {
			const heading = /^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
			if (heading?.[1]) current = heading[1].trim();
		}
		out.push(current);
	}
	return out;
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
	const markdown = MARKDOWN.has(extname(path).toLowerCase());
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
				metadata: { path, heading: null, line: 1, page: null },
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
			out.push(
				new Document({
					pageContent: piece.pageContent,
					metadata: { path, heading: headings[line - 1] ?? null, line, page },
				}),
			);
		}
	}
	return out;
}
