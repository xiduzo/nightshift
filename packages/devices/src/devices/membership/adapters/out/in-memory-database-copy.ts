import type { DatabaseCopy } from "../../application/ports";

/** `DatabaseCopy` in memory for use-case and contract tests. */
export function inMemoryDatabaseCopy(
	base = "/tmp",
): DatabaseCopy & { copies: string[] } {
	const copies: string[] = [];
	return {
		copies,
		async copy(_dataDir, _at, before = "personal-merge") {
			const path = `${base}/before-${before}.db`;
			copies.push(path);
			return path;
		},
	};
}
