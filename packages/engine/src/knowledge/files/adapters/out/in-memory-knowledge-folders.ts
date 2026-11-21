import { createHash } from "node:crypto";
import type { FolderSnapshot } from "../../../../folder-snapshot";
import type { KnowledgeFolders } from "../../application/ports";
import { cleanPath, isKnowledgePath, isReadable } from "../../domain/paths";
import { textResult } from "../../domain/text";

/** A file of a folder in memory: its text and its time of change. */
export type MemoryFile = { text: string; changedAt: number };

/**
 * A look at a folder in memory, as `snapshotFolder` takes one of a folder on
 * the disk: the files that count, by path, and those a person or an agent
 * reads. Test code.
 */
export function memorySnapshot(
	dir: string,
	files: ReadonlyMap<string, MemoryFile>,
): FolderSnapshot {
	const counted = [...files]
		.filter(([path]) => isKnowledgePath(path))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, file]) => ({
			path,
			size: Buffer.byteLength(file.text),
			changedAt: file.changedAt,
		}));
	const readable = counted.filter((file) => isReadable(file.path));
	const byPath = new Map(counted.map((file) => [file.path, file]));
	return {
		dir,
		files: counted,
		readable,
		newestReadable: Math.max(0, ...readable.map((file) => file.changedAt)),
		file: (path) => byPath.get(path),
		changedSince<Stamp extends { size: number; mtimeMs: number }>(
			base: ReadonlyMap<string, Stamp>,
			among = counted,
		) {
			const changed = new Map<string, (typeof counted)[number]>();
			const seen = new Set<string>();
			for (const file of among) {
				seen.add(file.path);
				const known = base.get(file.path);
				if (
					!known ||
					known.size !== file.size ||
					known.mtimeMs !== file.changedAt
				) {
					changed.set(file.path, file);
				}
			}
			const gone = [...base].filter(([path]) => !seen.has(path));
			return { changed, gone: gone.map(([, stamp]) => stamp) };
		},
		async sha256(path) {
			const file = files.get(path);
			return file ? createHash("sha256").update(file.text).digest("hex") : null;
		},
	};
}

/**
 * `KnowledgeFolders` in memory: a folder per project, `/knowledge/<id>`. A
 * test puts a file (`put`) where a sync would write one.
 */
export function inMemoryKnowledgeFolders() {
	const folders = new Map<string, Map<string, MemoryFile>>();
	const filesOf = (projectId: string) => {
		const files = folders.get(projectId) ?? new Map<string, MemoryFile>();
		folders.set(projectId, files);
		return files;
	};
	const twin = {
		/** Puts a file in the project's folder, as a sync would write it. */
		put(projectId: string, path: string, text: string, changedAt = 1) {
			filesOf(projectId).set(path, { text, changedAt });
		},
		folder: (projectId: string) => `/knowledge/${projectId}`,
		async ensure(projectId: string) {
			filesOf(projectId);
			return twin.folder(projectId);
		},
		async known() {
			return [...folders.keys()].sort();
		},
		async scan(projectId: string) {
			return memorySnapshot(
				twin.folder(projectId),
				folders.get(projectId) ?? new Map(),
			);
		},
		async read(projectId: string, path: string, maxBytes: number) {
			const clean = cleanPath(path);
			const file = clean ? folders.get(projectId)?.get(clean) : undefined;
			if (!clean || !file) return null;
			const bytes = Math.max(1, maxBytes);
			return textResult(
				clean,
				file.text.slice(0, bytes),
				Buffer.byteLength(file.text),
				bytes,
			);
		},
	};
	return twin satisfies KnowledgeFolders;
}

export type InMemoryKnowledgeFolders = ReturnType<
	typeof inMemoryKnowledgeFolders
>;
