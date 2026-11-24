import { inMemoryAccess } from "../../access/adapters/out/in-memory-access";
import { keepPorts } from "../keep/test-support";
import {
	inMemoryHostRelay,
	inMemoryProjectRuns,
} from "./adapters/out/in-memory-neighbours";

/**
 * Every port of the catalog, with the shared ones of `keep` over a database
 * in memory: where each use-case test starts. `person-ada` is an admin of the Spaces `s1`, `s2` and `team`.
 */
export async function catalogPorts() {
	const access = inMemoryAccess();
	for (const spaceId of ["s1", "s2", "team"]) {
		access.members.join(spaceId, "person-ada", "admin");
	}
	return {
		access,
		...(await keepPorts()),
		relay: inMemoryHostRelay(),
		runs: inMemoryProjectRuns(),
	};
}
