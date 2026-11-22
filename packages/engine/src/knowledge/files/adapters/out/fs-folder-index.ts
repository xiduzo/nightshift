import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { KNOWLEDGE_INDEX_FILE } from "@nightshift/flows";
import { writeWhole } from "../../../../archive";
import { isDocument, loadDocument, readStart } from "../../../../file-loaders";
import type { FolderIndex } from "../../application/ports";
import { HEAD_BYTES, isText } from "../../domain/describe";

/** The index of a folder on the disk: `INDEX.md` at its top. */
export function fsFolderIndex(): FolderIndex {
	const abs = (dir: string, path: string) => join(dir, ...path.split("/"));
	return {
		async written(dir) {
			const indexPath = join(dir, KNOWLEDGE_INDEX_FILE);
			const written = await stat(indexPath).catch(() => null);
			if (written === null) return null;
			const text = await readFile(indexPath, "utf8").catch(() => "");
			return { mtimeMs: written.mtimeMs, text };
		},
		async source(dir, path) {
			if (isDocument(path)) {
				return { docs: await loadDocument(abs(dir, path)) };
			}
			const head = isText(path)
				? await readStart(abs(dir, path), HEAD_BYTES)
				: null;
			return { text: head?.text ?? "" };
		},
		head: (dir, path, bytes) => readStart(abs(dir, path), bytes),
		write: (dir, text) => writeWhole(join(dir, KNOWLEDGE_INDEX_FILE), text),
	};
}
