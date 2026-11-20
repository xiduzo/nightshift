import { inMemoryKeepPorts } from "../../../keep/adapters/out/in-memory-neighbours";
import type { KnownSpaces } from "../../application/ports";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryClonesPorts`,
 * which gives a use-case test every port of the clones at once, with the
 * shared ones of `keep`. Test code: production code never imports this
 * file.
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

/** Every port of the clones in memory at once: where each use-case test starts. */
export function inMemoryClonesPorts() {
	return { ...inMemoryKeepPorts(), knownSpaces: inMemoryKnownSpaces() };
}
