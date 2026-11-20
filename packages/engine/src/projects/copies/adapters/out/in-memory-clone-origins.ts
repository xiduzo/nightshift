import type { CloneOrigins } from "../../application/ports";

/**
 * `CloneOrigins` in memory: the `origin` of each clone, as `host/path`. A
 * test sets them (`set`). A match in another case takes the project's
 * case, as git's `set-url` does. Test code.
 */
export function inMemoryCloneOrigins() {
	const origins = new Map<string, string>();
	const twin = {
		origins,
		set(path: string, remote: string) {
			origins.set(path, remote);
		},
		async match(path: string, remote: string) {
			const found = origins.get(path);
			if (found === undefined) return false;
			if (found === remote) return true;
			if (found.toLowerCase() !== remote.toLowerCase()) return false;
			origins.set(path, remote);
			return true;
		},
	};
	return twin satisfies CloneOrigins;
}

export type InMemoryCloneOrigins = ReturnType<typeof inMemoryCloneOrigins>;
