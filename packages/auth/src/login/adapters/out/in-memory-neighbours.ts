import { inMemoryCredentials } from "./in-memory-credentials";
import { inMemorySessionStore } from "./in-memory-session-store";
/**
 * `inMemoryLoginPorts`, which gives a use-case test every port of login
 * at once. Test code: production code never imports this file.
 */

/** Every port of login in memory at once: where each use-case test starts. */
export function inMemoryLoginPorts() {
	return {
		credentials: inMemoryCredentials(),
		sessionStore: inMemorySessionStore(),
	};
}
