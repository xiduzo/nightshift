import type { KnownSpaces } from "../../application/ports";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`). Test code: production code never
 * imports this file.
 */

/** The Spaces this Replica has. */
export function inMemoryKnownSpaces(spaces: readonly string[] = []) {
	const known = new Set(spaces);
	const twin = {
		known,
		exists: async (spaceId: string) => known.has(spaceId),
	};
	return twin satisfies KnownSpaces;
}
