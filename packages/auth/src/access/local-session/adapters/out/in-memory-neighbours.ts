import { findToken } from "../../application/find-token";
import { createTokenCell } from "../../domain/local-token";
import { inMemorySessions } from "./in-memory-sessions";

/**
 * `inMemoryLocalSessionPorts`, which gives a use-case test every port of
 * local-session at once. Test code: production code never imports this
 * file.
 */

/**
 * Every port of local-session in memory at once: where each use-case test
 * starts. The clock is the twin's (`sessions.now`), and `findToken` is
 * bound to the same ports, as the wire binds it.
 */
export function inMemoryLocalSessionPorts() {
	const sessions = inMemorySessions();
	const ports = {
		sessions,
		token: createTokenCell(),
		now: () => sessions.now,
	};
	return { ...ports, findToken: findToken(ports) };
}
