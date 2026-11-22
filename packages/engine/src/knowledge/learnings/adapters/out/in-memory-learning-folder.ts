import type { LearningFolder } from "../../application/ports";

/** The learning folders in memory: each file's bytes, by project and path. */
export type InMemoryLearningFolder = LearningFolder & {
	/** The files, by `<projectId>:<path>`. */
	files: Map<string, Uint8Array>;
	/** A file's text, or undefined: no such file. */
	read(projectId: string, path: string): string | undefined;
	/** Puts a file there, as a test sets the folder up. */
	put(projectId: string, path: string, text: string): void;
};

export function inMemoryLearningFolder(): InMemoryLearningFolder {
	const files = new Map<string, Uint8Array>();
	const key = (projectId: string, path: string) => `${projectId}:${path}`;
	const bytesOf = (data: string | Uint8Array) =>
		typeof data === "string" ? new TextEncoder().encode(data) : data;
	const twin: InMemoryLearningFolder = {
		files,
		read(projectId, path) {
			const bytes = files.get(key(projectId, path));
			return bytes && new TextDecoder().decode(bytes);
		},
		put(projectId, path, text) {
			files.set(key(projectId, path), bytesOf(text));
		},
		async has(projectId, path) {
			return files.has(key(projectId, path));
		},
		async bytes(projectId, path) {
			return files.get(key(projectId, path)) ?? null;
		},
		async text(projectId, path) {
			return twin.read(projectId, path) ?? null;
		},
		async append(projectId, path, data) {
			const before = files.get(key(projectId, path)) ?? new Uint8Array();
			const added = bytesOf(data);
			const next = new Uint8Array(before.length + added.length);
			next.set(before);
			next.set(added, before.length);
			files.set(key(projectId, path), next);
		},
		async write(projectId, path, text) {
			files.set(key(projectId, path), bytesOf(text));
		},
		async remove(projectId, path) {
			files.delete(key(projectId, path));
		},
	};
	return twin;
}
