import { homedir } from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
	type CallToolResult,
	CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { McpServerConfig } from "../port/types";

/**
 * One MCP client for one server: the Connections page's test, the
 * inspector's tool list and the Tool node all open a client here, do one
 * thing, and close it. A command server starts in the home directory, with
 * the daemon's default environment under the server's own. Secret values
 * are in the config already (`${NAME}` expanded by the engine): nothing here
 * logs the config.
 */

export const MCP_TIMEOUT_MS = 20_000;

/** A tool as the server lists it. `inputSchema` is a JSON Schema object. */
export type McpToolInfo = {
	name: string;
	description: string | null;
	inputSchema: Record<string, unknown>;
};

export type McpToolCall = {
	/** The result as the server sent it: text content joined, and structured content when present. */
	text: string;
	structuredContent: Record<string, unknown> | null;
	isError: boolean;
};

/** An open client; `close` is safe to call twice. */
export type McpSession = {
	client: Client;
	close(): Promise<void>;
};

function transportFor(config: McpServerConfig) {
	return "command" in config
		? new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: { ...getDefaultEnvironment(), ...config.env },
				cwd: homedir(),
				stderr: "pipe",
			})
		: new StreamableHTTPClientTransport(new URL(config.url), {
				requestInit: { headers: config.headers },
			});
}

/**
 * Runs `work` against a connected client and closes the client after.
 * `timeoutMs` bounds the connect and, unless `timeout` is `"connect"`, the
 * work too (a Tool node bounds its call with its own signal instead). An
 * aborted `signal` rejects with its reason and closes the client too.
 */
export async function withMcpClient<T>(
	config: McpServerConfig,
	work: (client: Client) => Promise<T>,
	options: {
		timeoutMs?: number;
		signal?: AbortSignal;
		timeout?: "connect" | "all";
	} = {},
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? MCP_TIMEOUT_MS;
	const client = new Client({ name: "nightshift", version: "1.0.0" });
	const transport = transportFor(config);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const stop = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(`No answer within ${Math.round(timeoutMs / 1000)} s.`),
				),
			timeoutMs,
		);
		const signal = options.signal;
		if (!signal) return;
		onAbort = () =>
			reject(
				signal.reason instanceof Error
					? signal.reason
					: new Error(String(signal.reason ?? "aborted")),
			);
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	// Nobody awaits `stop` alone: a rejection after the work is done is expected.
	stop.catch(() => {});
	try {
		await Promise.race([client.connect(transport), stop]);
		if (options.timeout === "connect") clearTimeout(timer);
		return await Promise.race([work(client), stop]);
	} finally {
		clearTimeout(timer);
		if (onAbort) options.signal?.removeEventListener("abort", onAbort);
		await client.close().catch(() => {});
	}
}

/** `tools/list` of one server: each tool's name, description and input schema. */
export async function listMcpTools(
	config: McpServerConfig,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<McpToolInfo[]> {
	return withMcpClient(
		config,
		async (client) => {
			const { tools } = await client.listTools();
			return tools.map(toolInfo);
		},
		options,
	);
}

export function toolInfo(tool: {
	name: string;
	description?: string;
	inputSchema: unknown;
}): McpToolInfo {
	return {
		name: tool.name,
		description: tool.description ?? null,
		inputSchema:
			tool.inputSchema && typeof tool.inputSchema === "object"
				? (tool.inputSchema as Record<string, unknown>)
				: { type: "object" },
	};
}

/**
 * What `callTool` may answer: a result with `content`, or the shape of
 * servers from before the 2025 protocol (`toolResult`).
 */
type AnyToolResult = Partial<
	Pick<CallToolResult, "content" | "structuredContent" | "isError">
> & { toolResult?: unknown };

/** The text content of a result, joined by newlines. */
export function toolResultText(result: AnyToolResult): string {
	if (!result.content) {
		return result.toolResult === undefined
			? ""
			: typeof result.toolResult === "string"
				? result.toolResult
				: JSON.stringify(result.toolResult);
	}
	return result.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n");
}

/**
 * `tools/call` on an open client, in Night Shift's shape. An unknown tool
 * or a transport failure throws; a tool that answers `isError` does not.
 */
export async function callMcpTool(
	client: Client,
	name: string,
	args: Record<string, unknown>,
	options?: RequestOptions,
): Promise<McpToolCall> {
	const result = await client.callTool(
		{ name, arguments: args },
		CallToolResultSchema,
		options,
	);
	return toolCallOf(result);
}

/** A `tools/call` result in Night Shift's shape. */
export function toolCallOf(result: AnyToolResult): McpToolCall {
	const structured = result.structuredContent;
	return {
		text: toolResultText(result),
		structuredContent:
			structured && typeof structured === "object" && !Array.isArray(structured)
				? (structured as Record<string, unknown>)
				: null,
		isError: result.isError === true,
	};
}
