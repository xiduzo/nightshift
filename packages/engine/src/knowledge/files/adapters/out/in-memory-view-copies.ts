import type { ViewCopies } from "../../application/ports";
import type { KnowledgeFile } from "../../domain/paths";
import { type MemoryFile, memorySnapshot } from "./in-memory-knowledge-folders";

/**
 * `ViewCopies` in memory. A file copies unless a test said it went
 * (`gone`). Each view keeps the files copied into it; `removed` lists the
 * views removed, in order.
 */
export function inMemoryViewCopies() {
	const views = new Map<string, Map<string, MemoryFile>>();
	let made = 0;
	const twin = {
		/** The paths whose file went since the look: they do not copy. */
		gone: new Set<string>(),
		/** The views removed, in order. */
		removed: [] as string[],
		/** The files of a view, by path. */
		filesOf: (view: string) => [...(views.get(view)?.keys() ?? [])],
		async make() {
			made++;
			const view = `/views/view-${made}`;
			views.set(view, new Map());
			return view;
		},
		async copy(_source: string, view: string, file: KnowledgeFile) {
			if (twin.gone.has(file.path)) return false;
			views.get(view)?.set(file.path, {
				text: "x".repeat(file.size),
				changedAt: file.changedAt,
			});
			return true;
		},
		async scan(view: string) {
			return memorySnapshot(view, views.get(view) ?? new Map());
		},
		async remove(view: string) {
			twin.removed.push(view);
			views.delete(view);
		},
	};
	return twin satisfies ViewCopies;
}

export type InMemoryViewCopies = ReturnType<typeof inMemoryViewCopies>;
