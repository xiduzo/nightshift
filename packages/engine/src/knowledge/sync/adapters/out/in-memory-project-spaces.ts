import type { ProjectSpaces } from "../../application/ports";

/**
 * `ProjectSpaces` in memory. A test adds a project in its Space (`add`) and
 * a Space that is not personal (`share`), where the rows would be.
 */
export function inMemoryProjectSpaces() {
	const projects = new Map<string, string>();
	const shared = new Set<string>();
	const twin = {
		/** Adds a project in a Space. */
		add(projectId: string, spaceId: string) {
			projects.set(projectId, spaceId);
		},
		/** Makes a Space one with more Members than one Person. */
		share(spaceId: string) {
			shared.add(spaceId);
		},
		async spaceOf(projectId: string) {
			return projects.get(projectId) ?? null;
		},
		async isShared(spaceId: string) {
			return shared.has(spaceId);
		},
		async projectsIn(spaceId: string) {
			return [...projects]
				.filter(([, space]) => space === spaceId)
				.map(([projectId]) => projectId);
		},
	};
	return twin satisfies ProjectSpaces;
}

export type InMemoryProjectSpaces = ReturnType<typeof inMemoryProjectSpaces>;
