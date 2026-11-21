import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isKnowledgeId } from "@nightshift/flows";
import {
	isDocument,
	LOCAL_ONLY_BYTES,
	loadDocument,
} from "../../../../file-loaders";
import {
	type FolderSnapshot,
	snapshotFolder,
} from "../../../../folder-snapshot";
import type { KnowledgeFolders } from "../../application/ports";
import { cleanPath, isKnowledgePath, isReadable } from "../../domain/paths";
import {
	documentResult,
	type KnowledgeText,
	type ReadFrom,
	textResult,
	textResultFrom,
	tooLarge,
} from "../../domain/text";
import { readStart } from "./fs-read-start";

/**
 * The knowledge folders over the disk: `<dataDir>/knowledge/<projectId>/`.
 * Sync flows fill a folder with Commands (the `knowledge/*` kits), through
 * the folder the step gets in `NS_KNOWLEDGE`. Which files count and what
 * changed is `folder-snapshot`, over the path rules of `domain/paths.ts`.
 */

/** An id as one file or folder name: nothing that could leave the folder. */
function folderName(id: string): string {
	if (!isKnowledgeId(id)) {
		throw new Error(`"${id}" is not an id.`);
	}
	return id;
}

/** The knowledge folder `dir` as it is now. No folder there: a snapshot with no files. */
export function scanFolder(dir: string): Promise<FolderSnapshot> {
	return snapshotFolder(dir, {
		counts: isKnowledgePath,
		readable: isReadable,
	});
}

export function fsKnowledgeFolders(dataDir: string): KnowledgeFolders {
	const root = join(dataDir, "knowledge");
	const folder = (projectId: string) => join(root, folderName(projectId));
	return {
		folder,
		async ensure(projectId) {
			const path = folder(projectId);
			await mkdir(path, { recursive: true });
			return path;
		},
		async known() {
			const names = await readdir(root, { withFileTypes: true }).catch(
				() => [],
			);
			return names
				.filter((entry) => entry.isDirectory() && isKnowledgeId(entry.name))
				.map((entry) => entry.name)
				.sort();
		},
		scan: (projectId) => scanFolder(folder(projectId)),
		read: (projectId, path, maxBytes, from) =>
			readFolderFile(folder(projectId), path, maxBytes, from),
	};
}

/**
 * One file of the knowledge folder `dir`, by its path, at most `maxBytes`
 * of its text: a PDF or Word file's text, any other file's first bytes.
 * Null when the folder has no such file, or the path is not one a person
 * or an agent reads, or a link leads it out of the folder. Refuses a file
 * that is not text and a document whose text it cannot read.
 */
async function readFolderFile(
	dir: string,
	path: string,
	maxBytes: number,
	from?: ReadFrom,
): Promise<KnowledgeText | null> {
	const clean = cleanPath(path);
	if (clean === null) return null;
	const abs = join(dir, ...clean.split("/"));
	const info = await lstat(abs).catch(() => null);
	if (!info?.isFile()) return null;
	const [real, base] = await Promise.all([
		realpath(abs).catch(() => ""),
		realpath(dir).catch(() => ""),
	]);
	if (base === "" || !real.startsWith(`${base}/`)) return null;
	const bytes = Math.max(1, maxBytes);
	if (isDocument(clean)) {
		if (info.size > LOCAL_ONLY_BYTES) throw tooLarge(clean);
		return documentResult(clean, await loadDocument(abs, "read"), bytes, from);
	}
	if (from) {
		const whole = await readStart(abs, LOCAL_ONLY_BYTES);
		if (!whole) return null;
		return textResultFrom(clean, whole.text, whole.size, bytes, from);
	}
	const read = await readStart(abs, bytes);
	if (!read) return null;
	return textResult(clean, read.text, read.size, bytes);
}
