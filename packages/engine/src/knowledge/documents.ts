import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import { Document } from "@langchain/core/documents";

/**
 * The text of a PDF or Word file in the knowledge, so search finds its
 * words, `read_knowledge` reads it, and `INDEX.md` gives its title.
 *
 * `PdfLoader` and `DocxLoader` read them. They are LangChain document loaders,
 * so a text splitter or vector store takes their `Document`s as they are. They
 * live here because the loaders of `@langchain/community` are at their end: that
 * package is sunset, its repository is archived, and it brings a vendor SDK with
 * it. Both call a maintained library with no native parts, `unpdf` and `mammoth`,
 * which `bun build --compile` can carry in the `nightshift` binary. The libraries
 * load on the first document, not when Night Shift starts.
 *
 * A file over 10 MB is not read: it stays on the Device that has it (ADR 4)
 * and its text could hold a lot of memory. It shows by its name only. So
 * does a file that does not open as its kind.
 *
 * A file is parsed once per change: `INDEX.md` and the search index read
 * it one after the other, so the last documents read stay here while the
 * file keeps its size and time of change.
 */

/** A file larger than this stays on the Device that has it (ADR 4, decision 9). */
export const LOCAL_ONLY_BYTES = 10 * 1024 * 1024;

/** The documents whose text Night Shift takes out. */
const DOCUMENT_FILES = new Set([".pdf", ".docx"]);

export const isDocument = (path: string) =>
	DOCUMENT_FILES.has(extname(path).toLowerCase());

/**
 * What a document's `Document`s carry. `source` is the path that was
 * loaded. A PDF gives one `Document` per page with text, with its page
 * number in `loc`. `title` is the title the PDF itself gives, when it gives
 * one. A Word file gives one `Document`.
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

/**
 * A page's text: a new line where the next piece of text sits at another
 * height, nothing between pieces at the same height.
 */
function pageText(items: readonly object[]): string {
	let lastY: unknown;
	let text = "";
	for (const item of items) {
		if (!("str" in item) || !("transform" in item)) continue;
		const y = (item.transform as unknown[])[5];
		text += lastY === y || !lastY ? item.str : `\n${item.str}`;
		lastY = y;
	}
	return text;
}

/** A PDF as one `Document` per page with text, by the PDF.js of `unpdf`. */
class PdfLoader extends BaseDocumentLoader {
	constructor(
		private readonly content: Uint8Array,
		private readonly source: string,
	) {
		super();
	}

	async load(): Promise<Document<DocumentMetadata>[]> {
		const { getResolvedPDFJS } = await import("unpdf");
		const { getDocument } = await getResolvedPDFJS();
		const task = getDocument({
			data: this.content,
			useWorkerFetch: false,
			useSystemFonts: true,
			// Errors only: a broken file is not news in the log.
			verbosity: 0,
		});
		try {
			const pdf = await task.promise;
			const info = (await pdf.getMetadata().catch(() => null))?.info;
			const title = pdfTitle(info);
			const pages: Document<DocumentMetadata>[] = [];
			for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
				const page = await pdf.getPage(pageNumber);
				const { items } = await page.getTextContent();
				if (items.length === 0) continue;
				pages.push(
					new Document<DocumentMetadata>({
						pageContent: pageText(items),
						metadata: {
							source: this.source,
							...(title ? { title } : {}),
							pdf: { info, totalPages: pdf.numPages },
							loc: { pageNumber },
						},
					}),
				);
			}
			return pages;
		} finally {
			// Frees the document and its worker, also when it did not open.
			await task.destroy().catch(() => {});
		}
	}
}

/** A Word file as one `Document`, by `mammoth`. Nothing when it holds no text. */
class DocxLoader extends BaseDocumentLoader {
	constructor(
		private readonly content: Uint8Array,
		private readonly source: string,
	) {
		super();
	}

	async load(): Promise<Document<DocumentMetadata>[]> {
		const { extractRawText } = await import("mammoth");
		const { value } = await extractRawText({
			buffer: Buffer.from(this.content),
		});
		return value
			? [
					new Document<DocumentMetadata>({
						pageContent: value,
						metadata: { source: this.source },
					}),
				]
			: [];
	}
}

/** How many files' documents stay parsed. */
const PARSED_FILES = 16;

/** The documents of the files parsed last, by path, while they stay as they were. */
const parsed = new Map<
	string,
	{ size: number; mtimeMs: number; docs: Document<DocumentMetadata>[] }
>();

/** Copies, so no reader changes what another reads. */
const copies = (docs: Document<DocumentMetadata>[]) =>
	docs.map(
		(doc) =>
			new Document<DocumentMetadata>({
				pageContent: doc.pageContent,
				metadata: { ...doc.metadata },
			}),
	);

/** A document's content parsed as its kind, its text tidied, from `source`. */
async function parse(
	kind: string,
	content: Uint8Array,
	source: string,
): Promise<Document<DocumentMetadata>[]> {
	const loader =
		kind === ".pdf"
			? // A copy on its own buffer: PDF.js may take the one it gets away.
				new PdfLoader(content.slice(), source)
			: new DocxLoader(content, source);
	return (await loader.load()).flatMap((doc) => {
		const pageContent = tidy(doc.pageContent);
		if (pageContent === "") return [];
		doc.pageContent = pageContent;
		return [doc];
	});
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
			const kept = parsed.get(abs);
			if (kept?.size === info.size && kept.mtimeMs === info.mtimeMs) {
				// The latest at the end: the oldest goes first.
				parsed.delete(abs);
				parsed.set(abs, kept);
				return copies(kept.docs);
			}
			const docs = await parse(kind, new Uint8Array(await readFile(abs)), abs);
			parsed.delete(abs);
			parsed.set(abs, { size: info.size, mtimeMs: info.mtimeMs, docs });
			for (const old of parsed.keys()) {
				if (parsed.size <= PARSED_FILES) break;
				parsed.delete(old);
			}
			return copies(docs);
		} catch {
			return null;
		}
	});
}

/**
 * The `Document`s of a PDF or Word file's content, for a file this Device
 * has by its hash only: `path` says its kind. Null as `loadDocument` gives it.
 */
export function loadDocumentContent(
	path: string,
	content: Uint8Array,
): Promise<Document<DocumentMetadata>[] | null> {
	const kind = extname(path).toLowerCase();
	if (!DOCUMENT_FILES.has(kind) || content.length > LOCAL_ONLY_BYTES) {
		return Promise.resolve(null);
	}
	return oneAtATime(() => parse(kind, content, path).catch(() => null));
}

/** The text of a document's `Document`s: an empty line between pages. */
export const textOf = (docs: Document[]) =>
	tidy(docs.map((doc) => doc.pageContent).join("\n\n"));
