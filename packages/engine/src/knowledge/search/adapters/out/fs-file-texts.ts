import { join } from "node:path";
import { isDocument, loadDocument, readStart } from "../../../../file-loaders";
import type { FileTexts } from "../../application/ports";

/**
 * `FileTexts` on this computer's disk: the start of a text file, and the
 * pages of a PDF or Word file through its loader (`file-loaders`). `path` is
 * relative to the folder `dir`, with `/` between its parts. `wireSearch`
 * builds it.
 */
export function fsFileTexts(): FileTexts {
	const abs = (dir: string, path: string) => join(dir, ...path.split("/"));
	return {
		isDocument,
		async start(dir, path, maxBytes) {
			return (await readStart(abs(dir, path), maxBytes))?.text ?? null;
		},
		pages: (dir, path) => loadDocument(abs(dir, path)),
	};
}
