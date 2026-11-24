import { keepPorts } from "../keep/test-support";
import { inMemoryKnownSpaces } from "./adapters/out/in-memory-neighbours";

/** Every port of the clones, with the shared ones of `keep` over a database in memory: where each use-case test starts. */
export async function clonesPorts() {
	return { ...(await keepPorts()), knownSpaces: inMemoryKnownSpaces() };
}
