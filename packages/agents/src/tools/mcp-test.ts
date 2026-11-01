import { now } from "@nightshift/time";
import type { McpServerConfig } from "../port";
import { type McpToolInfo, toolInfo, withMcpClient } from "./mcp";

export type McpTestResult = {
	ok: boolean;
	server: { name: string; version: string } | null;
	tools: McpToolInfo[];
	error: string | null;
	ms: number;
};

/**
 * Connects to one MCP server, lists its tools, and disconnects
 * (`withMcpClient`). `redact` lists secret values to take out of any error
 * text.
 */
export async function testMcpServer(
	config: McpServerConfig,
	options: { redact?: string[]; timeoutMs?: number } = {},
): Promise<McpTestResult> {
	const started = now();
	const redact = (text: string) =>
		(options.redact ?? [])
			.filter((v) => v.length >= 4)
			.reduce((t, v) => t.replaceAll(v, "•••"), text);
	try {
		return await withMcpClient(
			config,
			async (client) => {
				const { tools } = await client.listTools();
				const version = client.getServerVersion();
				return {
					ok: true,
					server: version
						? { name: version.name, version: version.version }
						: null,
					tools: tools.map(toolInfo),
					error: null,
					ms: now() - started,
				};
			},
			{ timeoutMs: options.timeoutMs },
		);
	} catch (error) {
		return {
			ok: false,
			server: null,
			tools: [],
			error: redact(error instanceof Error ? error.message : String(error)),
			ms: now() - started,
		};
	}
}
