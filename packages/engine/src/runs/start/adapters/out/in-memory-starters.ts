import type { RunRow } from "../../../../log";
import type { RunSummary } from "../../../../read";
import type { Starters } from "../../application/ports";

/**
 * The starters in memory: a Person commits as the git identity a test
 * gives them (`author`), else as none. A summary names the run, the Person
 * who started it, this computer as its Walker, and its Device.
 */
export function inMemoryStarters(selfName = "This computer") {
	const authors = new Map<string, { name: string; email: string }>();
	const twin = {
		/** The Person commits as this identity. */
		author(personId: string, identity: { name: string; email: string }) {
			authors.set(personId, identity);
		},

		async gitAuthor(personId: string) {
			return authors.get(personId) ?? null;
		},
		async summary(row: RunRow, device: { id: string; name: string }) {
			const here = device.id === row.walkerId;
			return {
				id: row.id,
				projectId: row.projectId,
				title: row.title,
				worktreePath: row.worktreePath,
				startedBy: row.startedBy ? { id: row.startedBy, name: null } : null,
				walker: { id: row.walkerId, name: selfName, thisDevice: true },
				device: {
					id: device.id,
					name: here ? selfName : device.name,
					thisDevice: here,
				},
			} as unknown as RunSummary;
		},
	};
	return twin satisfies Starters;
}

export type InMemoryStarters = ReturnType<typeof inMemoryStarters>;
