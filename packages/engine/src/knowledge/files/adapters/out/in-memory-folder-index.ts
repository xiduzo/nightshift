import type { FolderIndex } from "../../application/ports";
import { type DocumentPage, HEAD_BYTES, isText } from "../../domain/describe";
import type { WrittenIndex } from "../../domain/index-text";

/**
 * `FolderIndex` in memory. A test puts a file of a folder (`putFile`), a
 * PDF or Word file's pages (`putDocument`) and the index as it is
 * (`setWritten`). The twin keeps each index it writes (`writes`) and each
 * head it reads (`heads`).
 */
export function inMemoryFolderIndex() {
	const indexes = new Map<string, WrittenIndex>();
	const files = new Map<string, string>();
	const documents = new Map<string, readonly DocumentPage[] | null>();
	const key = (dir: string, path: string) => `${dir}\u0000${path}`;
	const twin = {
		/** Every index written, in order. */
		writes: [] as { dir: string; text: string }[],
		/** Every head read, in order. */
		heads: [] as { dir: string; path: string; bytes: number }[],
		/** The folder's index as it is now. */
		setWritten(dir: string, written: WrittenIndex) {
			indexes.set(dir, written);
		},
		/** A file of the folder. */
		putFile(dir: string, path: string, text: string) {
			files.set(key(dir, path), text);
		},
		/** A PDF or Word file of the folder, and its pages (null: it does not open). */
		putDocument(
			dir: string,
			path: string,
			pages: readonly DocumentPage[] | null,
		) {
			documents.set(key(dir, path), pages);
		},
		async written(dir: string) {
			return indexes.get(dir) ?? null;
		},
		async source(dir: string, path: string) {
			if (documents.has(key(dir, path))) {
				return { docs: documents.get(key(dir, path)) ?? null };
			}
			const text = isText(path) ? (files.get(key(dir, path)) ?? "") : "";
			return { text: text.slice(0, HEAD_BYTES) };
		},
		async head(dir: string, path: string, bytes: number) {
			twin.heads.push({ dir, path, bytes });
			const text = files.get(key(dir, path));
			if (text === undefined) return null;
			return { text: text.slice(0, bytes), size: Buffer.byteLength(text) };
		},
		async write(dir: string, text: string) {
			twin.writes.push({ dir, text });
			indexes.set(dir, { mtimeMs: Number.MAX_SAFE_INTEGER, text });
		},
	};
	return twin satisfies FolderIndex;
}

export type InMemoryFolderIndex = ReturnType<typeof inMemoryFolderIndex>;
