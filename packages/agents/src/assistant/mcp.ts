/**
 * An MCP server around a list of tools: what `nightshift mcp` serves on
 * stdio to an agent in a terminal. The tools are the same TanStack AI tool
 * definitions the chat bridges into a harness session; this only lists
 * them and runs a call. A tool that throws answers with its message as an
 * error result, so the agent reads why and can try again.
 *
 * The MCP SDK loads on first use: the package root must not load it.
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { BridgedTool } from "../port";

export type ToolServerInfo = {
	name: string;
	version: string;
	/** What the agent reads first: how to use the tools. */
	instructions?: string;
	/** Resources the server lists and reads besides its tools (MCP 2025-11-25). */
	resources?: ToolServerResources;
};

/** One resource the server lists. */
export type ToolServerResource = {
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	/** Bytes. */
	size?: number;
};

/** The resources of a tool server: a list, and the text of one by its URI. */
export type ToolServerResources = {
	list(): Promise<ToolServerResource[]>;
	/** The resource's text. Null: no such resource. */
	read(uri: string): Promise<{ text: string; mimeType: string } | null>;
};

/** The error code of a resource that is not there, as the MCP spec names it. */
const RESOURCE_NOT_FOUND = -32002;

const EMPTY_INPUT = { type: "object", properties: {} } as const;

/** An MCP server that lists `tools` and runs their calls. */
async function toolServer(
	tools: readonly BridgedTool[],
	info: ToolServerInfo,
): Promise<Server> {
	const [
		{ Server },
		{
			CallToolRequestSchema,
			ListResourcesRequestSchema,
			ListToolsRequestSchema,
			McpError,
			ReadResourceRequestSchema,
		},
	] = await Promise.all([
		import("@modelcontextprotocol/sdk/server/index.js"),
		import("@modelcontextprotocol/sdk/types.js"),
	]);
	const { resources } = info;
	const server = new Server(
		{ name: info.name, version: info.version },
		{
			capabilities: { tools: {}, ...(resources ? { resources: {} } : {}) },
			...(info.instructions ? { instructions: info.instructions } : {}),
		},
	);
	if (resources) {
		server.setRequestHandler(ListResourcesRequestSchema, async () => ({
			resources: await resources.list(),
		}));
		server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
			const { uri } = request.params;
			const read = await resources.read(uri).catch((error: unknown) => {
				throw new McpError(
					RESOURCE_NOT_FOUND,
					error instanceof Error ? error.message : String(error),
					{ uri },
				);
			});
			if (!read) {
				throw new McpError(RESOURCE_NOT_FOUND, "Resource not found", { uri });
			}
			return { contents: [{ uri, mimeType: read.mimeType, text: read.text }] };
		});
	}
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: (tool.inputSchema ?? EMPTY_INPUT) as {
				type: "object";
				[key: string]: unknown;
			},
		})),
	}));
	server.setRequestHandler(
		CallToolRequestSchema,
		async (request): Promise<CallToolResult> => {
			const tool = byName.get(request.params.name);
			if (!tool?.execute) {
				return errorResult(`There is no tool ${request.params.name}.`);
			}
			try {
				const result = await tool.execute(request.params.arguments ?? {});
				return {
					content: [
						{
							type: "text",
							text:
								typeof result === "string" ? result : JSON.stringify(result),
						},
					],
				};
			} catch (error) {
				return errorResult(
					error instanceof Error ? error.message : String(error),
				);
			}
		},
	);
	return server;
}

function errorResult(text: string): CallToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

/**
 * Serves `tools` on `transport` (default: this process's stdin and
 * stdout) until the other end closes it.
 */
export async function serveTools(
	tools: readonly BridgedTool[],
	info: ToolServerInfo,
	transport?: Transport,
): Promise<Server> {
	const server = await toolServer(tools, info);
	const { StdioServerTransport } = await import(
		"@modelcontextprotocol/sdk/server/stdio.js"
	);
	await server.connect(transport ?? new StdioServerTransport());
	return server;
}
