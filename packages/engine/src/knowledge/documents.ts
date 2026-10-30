import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { LOCAL_ONLY_BYTES } from "./store";

/**
 * The text of a PDF or Word file in the knowledge, so search finds its
 * words, `read_knowledge` reads it, and `INDEX.md` gives its title.
 *
 * `unpdf` (a build of PDF.js with no native parts) reads a PDF, `mammoth`
 * a Word file. Both are plain JavaScript: they run under Bun and inside
 * the `nightshift` binary. They load on the first document, not when Night
 * Shift starts.
 *
 * A file over 10 MB is not read: it stays on the Device that has it (ADR 4)
 * and its text could hold a lot of memory. It shows by its name only. So
 * does a file that does not open as its kind.
 */

/** The documents whose text Night Shift takes out. */
export const DOCUMENT_FILES = new Set([".pdf", ".docx"]);

export const isDocument = (path: string) =>
	DOCUMENT_FILES.has(extname(path).toLowerCase());

/** One document at a time: a folder of PDFs never parses dozens at once. */
let queue: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
	const next = queue.then(work, work);
	queue = next.catch(() => {});
	return next;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
	const { extractText, getDocumentProxy } = await import("unpdf");
	// Errors only: a broken file is not news in the log.
	const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
	try {
		const { text } = await extractText(pdf, { mergePages: true });
		return text;
	} finally {
		// Frees the document and its worker.
		await pdf.loadingTask.destroy().catch(() => {});
	}
}

async function docxText(bytes: Uint8Array): Promise<string> {
	const { default: mammoth } = await import("mammoth");
	const { value } = await mammoth.extractRawText({
		buffer: Buffer.from(bytes),
	});
	return value;
}

/**
 * The text of the PDF or Word file at `abs`. Null when it is not one, is
 * larger than 10 MB, or does not open.
 */
export function documentText(abs: string): Promise<string | null> {
	const kind = extname(abs).toLowerCase();
	if (!DOCUMENT_FILES.has(kind)) return Promise.resolve(null);
	return oneAtATime(async () => {
		try {
			const info = await stat(abs);
			if (!info.isFile() || info.size > LOCAL_ONLY_BYTES) return null;
			const bytes = new Uint8Array(await readFile(abs));
			const text =
				kind === ".pdf" ? await pdfText(bytes) : await docxText(bytes);
			return text
				.replace(/\r\n?/g, "\n")
				.replace(/\n{3,}/g, "\n\n")
				.trim();
		} catch {
			return null;
		}
	});
}
