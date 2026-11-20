import { inMemorySpaceStore } from "./in-memory-space-store";

/**
 * `inMemorySpacesPorts`, which gives a use-case test every port of the
 * slice at once, and the use case of personal it calls, which records
 * whom it was asked for. Test code: production code never imports this
 * file.
 */

/** Every port of spaces in memory at once: where each use-case test starts. */
export function inMemorySpacesPorts() {
	const ensured: string[] = [];
	return {
		/** The Persons `ensurePersonalSpace` was asked for, in order. */
		ensured,
		ensurePersonalSpace: async (request: { personId: string }) => {
			ensured.push(request.personId);
			return `personal-of-${request.personId}`;
		},
		spaceStore: inMemorySpaceStore(),
	};
}
