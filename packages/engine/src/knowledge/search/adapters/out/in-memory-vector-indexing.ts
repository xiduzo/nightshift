import type { VectorIndexing } from "../../application/ports";

/**
 * `VectorIndexing` in memory: the ids of the sections that have a vector,
 * per project. A test reads what was asked (`calls`) and makes the next call
 * fail (`failNext`).
 */
export function inMemoryVectorIndexing() {
	const vectors = new Map<string, Set<string>>();
	let failure: unknown = null;
	const twin = {
		/** Each call: the project, the model and the sections' ids. */
		calls: [] as { projectId: string; model: string; ids: string[] }[],
		/** The next call throws this. */
		failNext(error: unknown) {
			failure = error;
		},
		/** How many sections of the project have a vector. */
		count: (projectId: string) => vectors.get(projectId)?.size ?? 0,
		async index(
			...[projectId, model, sections]: Parameters<VectorIndexing["index"]>
		) {
			const ids = sections.map((section) => section.section_id);
			twin.calls.push({ projectId, model: model.model, ids });
			if (failure !== null) {
				const error = failure;
				failure = null;
				throw error;
			}
			vectors.set(projectId, new Set(ids));
		},
	};
	return twin satisfies VectorIndexing;
}

export type InMemoryVectorIndexing = ReturnType<typeof inMemoryVectorIndexing>;
