import type { ReadMarks } from "../../application/ports";
import type { KeptRead } from "../../domain/page-read";

/** What a twin of `ReadMarks` keeps: share it between two twins as a file between two computers' runs. */
export type TwinMarkStore = Map<string, KeptRead>;

/**
 * `ReadMarks` in memory, over a store a test may share (`store`). It counts
 * the writes of what waits (`flushes`).
 */
export function inMemoryReadMarks(store: TwinMarkStore = new Map()) {
	const key = (projectId: string, reader: string, url: string) =>
		`${projectId}\0${reader} ${url}`;
	const twin = {
		store,
		flushes: 0,
		async get(projectId: string, reader: string, url: string) {
			return store.get(key(projectId, reader, url)) ?? null;
		},
		async set(
			projectId: string,
			reader: string,
			url: string,
			kept: Parameters<ReadMarks["set"]>[3],
		) {
			store.set(key(projectId, reader, url), {
				mark: { ...kept.mark },
				links: kept.links.slice(0, 1_000),
			});
		},
		async flush() {
			twin.flushes++;
		},
	};
	return twin satisfies ReadMarks;
}

export type InMemoryReadMarks = ReturnType<typeof inMemoryReadMarks>;
