import type { McpServerConfig } from "@nightshift/agents/types";
import type { McpServer } from "@nightshift/flows";

/** `${NAME}`: an environment variable name, as a shell would read it. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export type McpExpansion =
	| {
			ok: true;
			servers: Record<string, McpServerConfig>;
			/** The secret values put in for `${NAME}`: what a session's output hides. */
			values?: string[];
	  }
	/** `message` names the server and the variable, never a value. */
	| { ok: false; message: string };

/**
 * Expands `${NAME}` in the `env` values and `headers` of MCP servers (an
 * Agent node's connections) from `env`. Commands, arguments and
 * URLs stay as written. A variable that is not set refuses the whole set:
 * a server that starts without its token fails later and less clearly.
 */
export function expandMcpServers(
	servers: Record<string, McpServer> | undefined,
	env: Readonly<Record<string, string | undefined>>,
): McpExpansion {
	const expanded: Record<string, McpServerConfig> = {};
	const used = new Set<string>();
	for (const [name, server] of Object.entries(servers ?? {})) {
		const missing: string[] = [];
		const expand = (values: Record<string, string> | undefined) => {
			const out: Record<string, string> = {};
			for (const [key, value] of Object.entries(values ?? {})) {
				out[key] = value.replace(REFERENCE, (whole, variable: string) => {
					const found = env[variable];
					if (found === undefined) {
						missing.push(variable);
						return whole;
					}
					if (found !== "") used.add(found);
					return found;
				});
			}
			return out;
		};
		const config: McpServerConfig =
			"command" in server
				? {
						command: server.command,
						args: server.args ?? [],
						env: expand(server.env),
					}
				: { url: server.url, headers: expand(server.headers) };
		if (missing.length > 0) {
			const names = [...new Set(missing)];
			const [noun, isNot, it] =
				names.length === 1
					? ["secret", "it is", "it"]
					: ["secrets", "they are", "them"];
			return {
				ok: false,
				message: `The MCP server "${name}" needs the ${noun} ${names.join(", ")}, but ${isNot} not saved. Save ${it} on the Secrets page, or remove the reference.`,
			};
		}
		expanded[name] = config;
	}
	return { ok: true, servers: expanded, values: [...used] };
}
