import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { SectionSplitter } from "../../application/ports";
import {
	emptySection,
	headingsByLine,
	isMarkdown,
	pagesOf,
	placedSection,
	type SectionMetadata,
} from "../../domain/sections";

/**
 * `SectionSplitter` over LangChain's `RecursiveCharacterTextSplitter`.
 * Markdown is cut at its headings first (`## `, then `### ` and lower), then
 * at code fences, paragraphs and lines. Other text is cut at paragraphs and
 * lines. LangChain.js has no `MarkdownHeaderTextSplitter`, so the headings of
 * a section come from the line where it starts (`placedSection`).
 *
 * 1 200 characters with 150 of overlap: the vectors spike
 * (`docs/research/knowledge-vectors.md` §2.1) found fewer, larger sections
 * index two times faster and find more than sections of 600.
 * `wireSearch` builds it.
 */

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

const markdownSplitter = RecursiveCharacterTextSplitter.fromLanguage(
	"markdown",
	{ chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP },
);
const textSplitter = new RecursiveCharacterTextSplitter({
	chunkSize: CHUNK_SIZE,
	chunkOverlap: CHUNK_OVERLAP,
});

export function langchainSectionSplitter(): SectionSplitter {
	return {
		/** The sections as LangChain documents, each section on one page. */
		async split(path, content) {
			const pages = pagesOf(content);
			if (pages.length === 0) return [new Document(emptySection(path))];
			const markdown = isMarkdown(path);
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
						new Document(
							placedSection(path, piece.pageContent, { line, page }, headings),
						),
					);
				}
			}
			return out;
		},
	};
}
