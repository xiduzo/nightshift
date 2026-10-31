import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { Document } from "@langchain/core/documents";
import { LOCAL_ONLY_BYTES } from "./store";

/**
 * The text of a PDF or Word file in the knowledge, so search finds its
 * words, `read_knowledge` reads it, and `INDEX.md` gives its title.
 *
 * LangChain's document loaders read them: `PDFLoader` a PDF, `DocxLoader`
 * a Word file (it calls `mammoth`). Each gives LangChain `Document`s, so a
 * text splitter or vector store takes them as they are. The loaders load
 * on the first document, not when Night Shift starts.
 *
 * `PDFLoader` by default imports the old PDF.js of `pdf-parse` through a
 * path in a variable. `bun build --compile` cannot see that import, so the
 * `nightshift` binary would not find it, and that PDF.js is old. So we give
 * the loader the current PDF.js of `unpdf` (no native parts) instead.
 *
 * A file over 10 MB is not read: it stays on the Device that has it (ADR 4)
 * and its text could hold a lot of memory. It shows by its name only. So
 * does a file that does not open as its kind.
 */

/** The documents whose text Night Shift takes out. */
export const DOCUMENT_FILES = new Set([".pdf", ".docx"]);

export const isDocument = (path: string) =>
	DOCUMENT_FILES.has(extname(path).toLowerCase());

/**
 * What a document's `Document`s carry. `source` is the path that was
 * loaded. A PDF gives one `Document` per page with text, with `loc` and
 * `pdf` as `PDFLoader` sets them. `title` is the title the PDF itself
 * gives, when it gives one. A Word file gives one `Document`.
 */
export type DocumentMetadata = {
	source: string;
	title?: string;
	loc?: { pageNumber: number };
	pdf?: { totalPages: number; info?: unknown };
};

/** One document at a time: a folder of PDFs never parses dozens at once. */
let queue: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
	const next = queue.then(work, work);
	queue = next.catch(() => {});
	return next;
}

/** Line ends as `\n`, at most one empty line, no space at the ends. */
const tidy = (text: string) =>
	text
		.replace(/\r\n?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

/**
 * A title a program wrote, not a person: "Untitled", a file name, or
 * "Microsoft Word - plan.docx".
 */
const MADE_UP_TITLE =
	/^(untitled|microsoft \w+ - .*|.*\.(docx?|pdf|tex|dvi|txt|rtf|pptx?|xlsx?|odt|pages|indd))$/i;

/** The PDF's own title, from its info, when a person gave it. */
function pdfTitle(info: unknown): string | undefined {
	const title =
		info && typeof info === "object" && "Title" in info
			? (info as { Title?: unknown }).Title
			: undefined;
	if (typeof title !== "string") return undefined;
	const clean = title.replace(/\s+/g, " ").trim();
	return clean === "" || clean.length > 200 || MADE_UP_TITLE.test(clean)
		? undefined
		: clean;
}

async function loadPdf(blob: Blob): Promise<Document[]> {
	const [{ PDFLoader }, { getResolvedPDFJS }] = await Promise.all([
		import("@langchain/community/document_loaders/fs/pdf"),
		import("unpdf"),
	]);
	const { getDocument, version } = await getResolvedPDFJS();
	// The loader does not free the document it opens. We keep its task and
	// free it (and its worker) when the loader is done.
	const tasks: { destroy(): Promise<void> }[] = [];
	const pdfjs = async () => ({
		isV2: false as const,
		version,
		getDocument: (params: Parameters<typeof getDocument>[0]) => {
			// Errors only: a broken file is not news in the log.
			const task = getDocument({
				...(params as object),
				verbosity: 0,
			});
			tasks.push(task);
			return task;
		},
	});
	try {
		const pages = await new PDFLoader(blob, { pdfjs }).load();
		const title = pdfTitle(pages[0]?.metadata.pdf?.info);
		if (title) for (const page of pages) page.metadata.title = title;
		return pages;
	} finally {
		await Promise.all(tasks.map((task) => task.destroy().catch(() => {})));
	}
}

async function loadDocx(blob: Blob): Promise<Document[]> {
	const { DocxLoader } = await import(
		"@langchain/community/document_loaders/fs/docx"
	);
	return new DocxLoader(blob).load();
}

/**
 * The `Document`s of the PDF or Word file at `abs`, their text tidied.
 * Null when it is not one, is larger than 10 MB, or does not open. An
 * empty list when it opens but holds no text.
 */
export function loadDocument(
	abs: string,
): Promise<Document<DocumentMetadata>[] | null> {
	const kind = extname(abs).toLowerCase();
	if (!DOCUMENT_FILES.has(kind)) return Promise.resolve(null);
	return oneAtATime(async () => {
		try {
			const info = await stat(abs);
			if (!info.isFile() || info.size > LOCAL_ONLY_BYTES) return null;
			const blob = new Blob([await readFile(abs)]);
			const docs = kind === ".pdf" ? await loadPdf(blob) : await loadDocx(blob);
			return docs.flatMap((doc) => {
				const pageContent = tidy(doc.pageContent);
				if (pageContent === "") return [];
				doc.pageContent = pageContent;
				// The loaders say "blob": say which file it was.
				doc.metadata.source = abs;
				delete doc.metadata.blobType;
				return [doc as Document<DocumentMetadata>];
			});
		} catch {
			return null;
		}
	});
}

/** The text of a document's `Document`s: an empty line between pages. */
export const textOf = (docs: Document[]) =>
	tidy(docs.map((doc) => doc.pageContent).join("\n\n"));

/**
 * The text of the PDF or Word file at `abs`. Null when it is not one, is
 * larger than 10 MB, or does not open.
 */
export async function documentText(abs: string): Promise<string | null> {
	const docs = await loadDocument(abs);
	return docs === null ? null : textOf(docs);
}
