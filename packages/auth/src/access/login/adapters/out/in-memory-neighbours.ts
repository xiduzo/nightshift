import { inMemoryCredentials } from "./in-memory-credentials";
/**
 * `inMemoryLoginPorts`, the ports of login that are no database. Test code:
 * production code never imports this file.
 */

/** The ports of login that are no database, in memory. */
export function inMemoryLoginPorts() {
	return {
		credentials: inMemoryCredentials(),
	};
}
