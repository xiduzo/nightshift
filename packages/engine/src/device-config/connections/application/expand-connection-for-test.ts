import { type McpServer, mcpServerSchema } from "@nightshift/flows";
import { notRead, unreachableNote } from "../../../secrets";
import { noConnectionToTest } from "../domain/connection-words";
import { expandMcpServers, type McpExpansion } from "../domain/mcp-expansion";
import { referencedVariables } from "../domain/saved-connection";
import type { ConnectionSecrets, SavedConnections } from "./ports";

export type ExpandConnectionForTestPorts = {
	saved: Pick<SavedConnections, "read">;
	secrets: Pick<ConnectionSecrets, "resolveSecrets" | "noteSecretUse">;
};

/** A saved connection by name, or a draft server. */
export type ExpandConnectionForTest = { name: string } | { server: McpServer };

/**
 * One server, expanded, for a test: a saved connection by name, or a
 * draft. `values` are the secret values it read, to take out of error
 * text. A test connects to the server with the values: an expansion that
 * works notes the use.
 */
export const expandConnectionForTest =
	(ports: ExpandConnectionForTestPorts) =>
	async (
		target: ExpandConnectionForTest,
	): Promise<{ expansion: McpExpansion; values: string[] }> => {
		const server =
			"server" in target
				? mcpServerSchema.parse(target.server)
				: ports.saved.read().get(target.name)?.server;
		const name = "name" in target ? target.name : "draft";
		if (!server) {
			return {
				expansion: { ok: false, message: noConnectionToTest(name) },
				values: [],
			};
		}
		const variables = referencedVariables(server);
		const resolved = await ports.secrets.resolveSecrets({ names: variables });
		const { vars } = resolved;
		const expansion = expandMcpServers({ [name]: server }, vars);
		if (expansion.ok) ports.secrets.noteSecretUse(variables);
		const note = expansion.ok ? "" : unreachableNote(notRead(resolved));
		return {
			expansion:
				!expansion.ok && note
					? { ...expansion, message: `${expansion.message}${note}` }
					: expansion,
			values: variables.flatMap((v) => (vars[v] ? [vars[v]] : [])),
		};
	};
