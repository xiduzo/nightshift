import type { FileTexts } from "../../application/ports";
import type { SectionPage } from "../../domain/sections";

/**
 * `FileTexts` in memory. A test puts a file's text (`put`) or a document's
 * pages (`putPages`) where the real adapter would read them, and reads
 * which files were read (`read`).
 */
export function inMemoryFileTexts() {
	const texts = new Map<string, string>();
	const documents = new Map<string, SectionPage[]>();
	const key = (dir: string, path: string) => `${dir}\0${path}`;
	const twin = {
		/** The files read, as `<path>`, in order. */
		read: [] as string[],
		/** Puts a text file in the folder `dir`. */
		put(dir: string, path: string, text: string) {
			texts.set(key(dir, path), text);
		},
		/** Puts a PDF or Word file with these pages in the folder `dir`. */
		putPages(dir: string, path: string, pages: SectionPage[]) {
			documents.set(key(dir, path), pages);
		},
		isDocument: (path: string) => /\.(pdf|docx)$/i.test(path),
		async start(dir: string, path: string, maxBytes: number) {
			twin.read.push(path);
			const text = texts.get(key(dir, path));
			return text === undefined
				? null
				: Buffer.from(text).subarray(0, maxBytes).toString("utf8");
		},
		async pages(dir: string, path: string) {
			twin.read.push(path);
			return documents.get(key(dir, path)) ?? null;
		},
	};
	return twin satisfies FileTexts;
}

export type InMemoryFileTexts = ReturnType<typeof inMemoryFileTexts>;
