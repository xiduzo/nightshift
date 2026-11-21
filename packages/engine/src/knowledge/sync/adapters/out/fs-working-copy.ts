import {
	lstat,
	mkdir,
	readFile,
	rename,
	rm,
	rmdir,
	stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { KNOWLEDGE_RECONCILE_FILE } from "@nightshift/flows";
import { writeWhole } from "../../../../archive";
import { snapshotFolder } from "../../../../folder-snapshot";
import {
	isKnowledgePath,
	isReadable,
	type KnowledgeFolders,
} from "../../../files";
import type { WorkingCopy } from "../../application/ports";

/**
 * The working copy of a project's knowledge on the disk: its folder, as
 * `KnowledgeFolders` of `files` names and looks at it, and the state of
 * the last reconcile in `.reconciled.json` there.
 */
export function fsWorkingCopy(
	folders: Pick<KnowledgeFolders, "folder" | "known" | "scan">,
): WorkingCopy {
	const abs = (projectId: string, path: string) =>
		join(folders.folder(projectId), ...path.split("/"));
	const stateFile = (projectId: string) =>
		join(folders.folder(projectId), KNOWLEDGE_RECONCILE_FILE);
	return {
		folder: (projectId) => folders.folder(projectId),
		known: () => folders.known(),
		async ensure(projectId) {
			await mkdir(folders.folder(projectId), { recursive: true });
		},
		async exists(projectId) {
			return (await stat(folders.folder(projectId)).catch(() => null)) !== null;
		},
		scan: (projectId) => folders.scan(projectId),
		read: (projectId, path) =>
			readFile(abs(projectId, path))
				.then((buffer) => new Uint8Array(buffer))
				.catch(() => null),
		write(projectId, path, content) {
			const file = abs(projectId, path);
			return writeWhole(file, content)
				.then(() => stat(file))
				.then((written) => ({ size: written.size, mtimeMs: written.mtimeMs }))
				.catch(() => null);
		},
		inFolder: (projectId, path) => inFolder(folders.folder(projectId), path),
		remove: (projectId, path) => removeFile(folders.folder(projectId), path),
		readState: (projectId) =>
			readFile(stateFile(projectId), "utf8").catch(() => null),
		writeState: (projectId, text) => writeWhole(stateFile(projectId), text),
		move: (from, to) => moveFolder(folders.folder(from), folders.folder(to)),
	};
}

/**
 * Moves a knowledge folder to another place. When that place has a
 * folder already, each file goes into it, unless the file there is
 * newer. The old folder goes.
 */
async function moveFolder(from: string, to: string): Promise<void> {
	if ((await stat(to).catch(() => null)) === null) {
		await mkdir(dirname(to), { recursive: true });
		await rename(from, to);
		return;
	}
	const { files } = await snapshotFolder(from, {
		counts: isKnowledgePath,
		readable: isReadable,
	});
	for (const file of files) {
		const target = join(to, ...file.path.split("/"));
		if (!(await inFolder(to, file.path))) continue;
		const there = await stat(target).catch(() => null);
		if (there && there.mtimeMs >= file.changedAt) continue;
		await mkdir(dirname(target), { recursive: true });
		await rename(join(from, ...file.path.split("/")), target);
	}
	await rm(from, { recursive: true, force: true });
}

/**
 * Whether the folders of a path are real folders inside the knowledge
 * folder: a link among them could lead a write or a removal out of it.
 */
async function inFolder(root: string, path: string): Promise<boolean> {
	const parts = path.split("/");
	for (let depth = 1; depth < parts.length; depth++) {
		const info = await lstat(join(root, ...parts.slice(0, depth))).catch(
			() => null,
		);
		if (info === null) return true;
		if (!info.isDirectory()) return false;
	}
	return true;
}

/** Removes a file and the folders it leaves empty, up to the knowledge folder. */
async function removeFile(root: string, path: string): Promise<void> {
	const parts = path.split("/");
	await rm(join(root, ...parts), { force: true });
	for (let depth = parts.length - 1; depth > 0; depth--) {
		const removed = await rmdir(join(root, ...parts.slice(0, depth)))
			.then(() => true)
			.catch(() => false);
		if (!removed) return;
	}
}
