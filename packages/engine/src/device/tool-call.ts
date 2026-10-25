import {
	callMcpTool,
	MCP_TIMEOUT_MS,
	type McpToolCall,
	toolInfo,
	withMcpClient,
} from "@nightshift/agents/tools";
import type { McpServerConfig } from "@nightshift/agents/types";
import type { JsonValue } from "@nightshift/flows";

import type { ToolCallInput, ToolResult } from "./types";

/** The call could not be made: the server has no such tool. */
class UnknownTool extends Error {}

/**
 * One `tools/call` on an expanded MCP server: connect, list the tools (an
 * unknown tool fails, and the tool's input schema types the arguments),
 * call, disconnect. The signal bounds the whole call and closes the client.
 * Never throws.
 */
export async function callServerTool(
	server: McpServerConfig,
	input: ToolCallInput,
): Promise<ToolResult> {
	const { connection, tool: name, signal } = input;
	let sent: Record<string, JsonValue> | null = null;
	let call: McpToolCall;
	try {
		call = await withMcpClient(
			server,
			async (client) => {
				const { tools } = await client.listTools();
				const tool = tools.find((t) => t.name === name);
				if (!tool) {
					const names = tools.map((t) => t.name).sort();
					throw new UnknownTool(
						`The connection "${connection}" has no tool named "${name}".${names.length > 0 ? ` It has: ${names.join(", ")}.` : ""}`,
					);
				}
				sent = coerceArguments(input.arguments, toolInfo(tool).inputSchema);
				// The signal bounds the call; the SDK's own request timeout (a
				// minute) is too short for a tool that works.
				return callMcpTool(client, name, sent, {
					signal,
					timeout: 2_147_483_647,
				});
			},
			{ signal, timeoutMs: MCP_TIMEOUT_MS, timeout: "connect" },
		);
	} catch (error) {
		return {
			kind: "failed",
			message:
				error instanceof UnknownTool
					? error.message
					: `The connection "${connection}" did not answer: ${messageOf(error)}`,
			arguments: sent,
		};
	}
	return {
		kind: "called",
		arguments: sent ?? input.arguments,
		text: call.text,
		structuredContent: call.structuredContent,
		isError: call.isError,
	};
}

/**
 * Reads each text argument as the tool's input schema says: a number,
 * integer, boolean, object or array property takes the text as that value
 * when it reads as one, else the text stays and the server says what is
 * wrong. A value that is not text, or a property the schema does not type,
 * is left as it is.
 */
export function coerceArguments(
	args: Record<string, JsonValue>,
	inputSchema: Record<string, unknown>,
): Record<string, JsonValue> {
	const properties = inputSchema.properties;
	if (!properties || typeof properties !== "object") return args;
	const out: Record<string, JsonValue> = {};
	for (const [name, value] of Object.entries(args)) {
		const property = (properties as Record<string, unknown>)[name];
		if (!property || typeof property !== "object") {
			out[name] = value;
			continue;
		}
		const types = schemaTypes(property as Record<string, unknown>);
		out[name] =
			typeof value === "string"
				? coerce(value, types)
				: // A number or a boolean from a reference, for a text property.
					(typeof value === "number" || typeof value === "boolean") &&
						types.length === 1 &&
						types[0] === "string"
					? String(value)
					: value;
	}
	return out;
}

/** The `type` of a property: one name, a list, or none. */
function schemaTypes(property: Record<string, unknown>): string[] {
	const type = property.type;
	if (typeof type === "string") return [type];
	if (Array.isArray(type)) return type.filter((t) => typeof t === "string");
	const oneOf = property.anyOf ?? property.oneOf;
	if (Array.isArray(oneOf)) {
		return oneOf.flatMap((option) =>
			option && typeof option === "object"
				? schemaTypes(option as Record<string, unknown>)
				: [],
		);
	}
	return [];
}

function coerce(text: string, types: readonly string[]): JsonValue {
	if (types.length === 0 || types.includes("string")) return text;
	const trimmed = text.trim();
	if (types.includes("boolean")) {
		if (trimmed === "true") return true;
		if (trimmed === "false") return false;
	}
	if (types.includes("number") || types.includes("integer")) {
		const number = Number(trimmed);
		if (
			trimmed !== "" &&
			Number.isFinite(number) &&
			(types.includes("number") || Number.isInteger(number))
		) {
			return number;
		}
	}
	if (types.includes("null") && trimmed === "null") return null;
	if (types.includes("object") || types.includes("array")) {
		try {
			const parsed = JSON.parse(trimmed) as JsonValue;
			const isArray = Array.isArray(parsed);
			const isObject =
				!isArray && typeof parsed === "object" && parsed !== null;
			if (
				(isArray && types.includes("array")) ||
				(isObject && types.includes("object"))
			) {
				return parsed;
			}
		} catch {
			// Not JSON: the text stays, and the server says what is wrong.
		}
	}
	return text;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
