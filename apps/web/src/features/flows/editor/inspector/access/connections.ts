import type { Connection } from "@/shared/api";

/** A connection on this daemon, as `connections.list` returns it. */
export type DaemonConnection = Connection;

/** How a connection's server runs, in the words of the Connections page. */
export function connectionKind(connection: DaemonConnection): string {
	return "command" in connection.server ? "Local command" : "Remote URL";
}
