import type { AgentNode, McpServer } from "@nightshift/flows";
import type { SecretUse } from "../../../contract";
import { notRead, unreachableNote } from "../../../secrets";
import { noConnectionForNode } from "../domain/connection-words";
import { expandMcpServers, type McpExpansion } from "../domain/mcp-expansion";
import { referencedVariables } from "../domain/saved-connection";
import type { ConnectionSecrets, SavedConnections } from "./ports";

export type ExpandConnectionsPorts = {
	saved: Pick<SavedConnections, "read">;
	secrets: Pick<ConnectionSecrets, "resolveSecrets" | "noteSecretUse">;
};

/** An Agent node's connections, and the facts of the use. */
export type ExpandConnections = {
	node: Pick<AgentNode, "connections">;
	use?: SecretUse;
};

/**
 * An Agent node's MCP servers: its connections, with `${NAME}` expanded
 * from the scopes of the use. A name this computer has no connection of
 * refuses the set. An expansion that works notes the use of its secrets.
 * One that misses a secret says which scopes could not be read.
 */
export const expandConnections =
	(ports: ExpandConnectionsPorts) =>
	async (request: ExpandConnections): Promise<McpExpansion> => {
		const servers: Record<string, McpServer> = {};
		for (const name of request.node.connections ?? []) {
			const found = ports.saved.read().get(name);
			if (!found) return { ok: false, message: noConnectionForNode(name) };
			servers[name] = found.server;
		}
		const names = Object.values(servers).flatMap(referencedVariables);
		const resolved = await ports.secrets.resolveSecrets({
			names,
			use: request.use,
		});
		const expansion = expandMcpServers(servers, resolved.vars);
		if (expansion.ok) ports.secrets.noteSecretUse(names);
		else {
			const note = unreachableNote(notRead(resolved));
			if (note) return { ...expansion, message: `${expansion.message}${note}` };
		}
		return expansion;
	};
