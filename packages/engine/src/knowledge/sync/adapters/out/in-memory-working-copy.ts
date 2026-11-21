import { createHash } from "node:crypto";
import {
	type MemoryFile,
	memorySnapshot,
} from "../../../files/adapters/out/in-memory-knowledge-folders";
import type { WorkingCopy } from "../../application/ports";

/**
 * `WorkingCopy` in memory: a folder per project, `/knowledge/<id>`, with
 * its files and the text of its state. A test puts a file (`put`) as a
 * step would write it, makes a path a link out of the folder (`outside`),
 * and reads what the twin was asked, in order (`calls`).
 */
export function inMemoryWorkingCopy() {
	const folders = new Map<string, Map<string, MemoryFile>>();
	const states = new Map<string, string>();
	let clock = 1_000;
	const filesOf = (projectId: string) => {
		const files = folders.get(projectId) ?? new Map<string, MemoryFile>();
		folders.set(projectId, files);
		return files;
	};
	const twin = {
		/** What the twin was asked, in order: `write a.md`, `remove b.md`, `state`. */
		calls: [] as string[],
		/** The paths whose folders lead out of the knowledge folder. */
		outside: new Set<string>(),
		/** Puts a file, as a step would write it. */
		put(projectId: string, path: string, text: string, changedAt = ++clock) {
			filesOf(projectId).set(path, { text, changedAt });
		},
		/** The text of a file, or undefined. */
		text: (projectId: string, path: string) =>
			folders.get(projectId)?.get(path)?.text,
		/** The text of the state, or undefined. */
		state: (projectId: string) => states.get(projectId),
		/** The hash of a text, as the archive keeps it. */
		hash: (text: string) => createHash("sha256").update(text).digest("hex"),
		folder: (projectId: string) => `/knowledge/${projectId}`,
		async known() {
			return [...folders.keys()].sort();
		},
		async ensure(projectId: string) {
			filesOf(projectId);
		},
		async exists(projectId: string) {
			return folders.has(projectId);
		},
		async scan(projectId: string) {
			twin.calls.push("scan");
			return memorySnapshot(
				twin.folder(projectId),
				folders.get(projectId) ?? new Map(),
			);
		},
		async read(projectId: string, path: string) {
			const file = folders.get(projectId)?.get(path);
			return file ? new TextEncoder().encode(file.text) : null;
		},
		async write(projectId: string, path: string, content: Uint8Array) {
			twin.calls.push(`write ${path}`);
			const changedAt = ++clock;
			const text = new TextDecoder().decode(content);
			filesOf(projectId).set(path, { text, changedAt });
			return { size: content.length, mtimeMs: changedAt };
		},
		async inFolder(_projectId: string, path: string) {
			return !twin.outside.has(path);
		},
		async remove(projectId: string, path: string) {
			twin.calls.push(`remove ${path}`);
			folders.get(projectId)?.delete(path);
		},
		async readState(projectId: string) {
			return states.get(projectId) ?? null;
		},
		async writeState(projectId: string, text: string) {
			twin.calls.push("state");
			filesOf(projectId);
			states.set(projectId, text);
		},
		async move(from: string, to: string) {
			twin.calls.push(`move ${from} ${to}`);
			const moving = folders.get(from) ?? new Map<string, MemoryFile>();
			const there = filesOf(to);
			for (const [path, file] of moving) {
				const kept = there.get(path);
				if (!kept || kept.changedAt < file.changedAt) there.set(path, file);
			}
			folders.delete(from);
		},
	};
	return twin satisfies WorkingCopy;
}

export type InMemoryWorkingCopy = ReturnType<typeof inMemoryWorkingCopy>;
