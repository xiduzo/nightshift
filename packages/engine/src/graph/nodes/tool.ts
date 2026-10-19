import {
	callMcpTool,
	MCP_TIMEOUT_MS,
	type McpToolCall,
	toolInfo,
	withMcpClient,
} from "@nightshift/agents/mcp";
import {
	type JsonValue,
	renderValue,
	type TemplateContext,
	type ToolNode,
} from "@nightshift/flows";

import type { StepOutputs } from "../../events";
import { messageOf, type NodeAction, type StepContext } from "../context";
import { RESUME_RULES } from "../resume-point";
import { type BodyResult, runStep, type StepHandle } from "../step-runner";

/**
 * The Tool node: one `tools/call` on a Connection's MCP server, with no
 * model in the loop. The Connection's server definition comes from the same
 * resolver the Agent node uses (`ctx.mcpServersFor`), so `${NAME}` secrets
 * are filled the same way and reach the client only. The step connects,
 * lists the tools (an unknown tool is `fail`, and the tool's input schema
 * types the arguments), records the call, calls, records the answer and
 * disconnects. `pass` when the tool answered without `isError`; `fail` on
 * `isError`, an unknown tool or a transport failure. Outputs: `data` (the
 * structured content, else the JSON the text holds, else null), `text`
 * (the text content joined) and `visit`.
 *
 * A stop of the run or the node's time budget aborts the step's signal,
 * which closes the client. Every visit is new (`RESUME_RULES.fresh`): a
 * parked or interrupted Tool step has nothing to continue. The step
 * lifecycle is the step runner's; this module is the body.
 */
export function toolNode(node: ToolNode, ctx: StepContext): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			body: (step) => callTool(ctx, node, step),
		});
}

/** The call could not be made: the server has no such tool. */
class UnknownTool extends Error {}

async function callTool(
	ctx: StepContext,
	node: ToolNode,
	step: StepHandle,
): Promise<BodyResult> {
	const { visit, signal } = step;
	const empty: StepOutputs = { visit, data: null, text: "" };
	const end = (
		outcome: string,
		outputs: StepOutputs,
		error: string | null,
	): BodyResult => ({ kind: "end", outcome, outputs, error });

	const mcp = await ctx.mcpServersFor({ connections: [node.connection] });
	if (!mcp.ok) return end("error", empty, mcp.message);
	const server = mcp.servers[node.connection];
	if (!server) {
		return end(
			"error",
			empty,
			`There is no connection named "${node.connection}". Add it under Agents → Tools, or pick another one.`,
		);
	}

	const rendered = renderArguments(node.arguments, step.tctx);
	let call: McpToolCall;
	/** Whether the transcript has the call: every Tool step records one, then its answer. */
	let recorded = false;
	const recordCall = (args: Record<string, JsonValue>) => {
		recorded = true;
		step.record(null, {
			type: "tool-call",
			connection: node.connection,
			tool: node.tool,
			arguments: args,
		});
	};
	try {
		call = await withMcpClient(
			server,
			async (client) => {
				const { tools } = await client.listTools();
				const tool = tools.find((t) => t.name === node.tool);
				if (!tool) {
					const names = tools.map((t) => t.name).sort();
					throw new UnknownTool(
						`The connection "${node.connection}" has no tool named "${node.tool}".${names.length > 0 ? ` It has: ${names.join(", ")}.` : ""}`,
					);
				}
				const args = coerceArguments(rendered, toolInfo(tool).inputSchema);
				recordCall(args);
				// The step's signal bounds the call; the SDK's own request
				// timeout (a minute) is too short for a tool that works.
				return callMcpTool(client, node.tool, args, {
					signal,
					timeout: 2_147_483_647,
				});
			},
			{ signal, timeoutMs: MCP_TIMEOUT_MS, timeout: "connect" },
		);
	} catch (error) {
		if (signal.aborted) return { kind: "aborted", outputs: empty };
		const message =
			error instanceof UnknownTool
				? error.message
				: `The connection "${node.connection}" did not answer: ${messageOf(error)}`;
		if (!recorded) recordCall(rendered);
		step.record(null, {
			type: "tool-called",
			isError: true,
			text: message,
			data: null,
		});
		return end("fail", empty, message);
	}

	const data = dataOf(call);
	step.record(null, {
		type: "tool-called",
		isError: call.isError,
		text: call.text,
		data,
	});
	const outputs: StepOutputs = { ...empty, data, text: call.text };
	if (signal.aborted) return { kind: "aborted", outputs };
	return end(
		call.isError ? "fail" : "pass",
		outputs,
		call.isError ? call.text || "The tool reported an error." : null,
	);
}

/**
 * The `data` output of a call: the structured content when the tool sent
 * some, else the JSON its text holds when the whole text parses, else null.
 */
export function dataOf(call: McpToolCall): JsonValue | null {
	if (call.structuredContent) return call.structuredContent as JsonValue;
	const text = call.text.trim();
	if (text === "") return null;
	try {
		return JSON.parse(text) as JsonValue;
	} catch {
		return null;
	}
}

/** Each argument rendered: one reference keeps its JSON value, other text is a string. */
export function renderArguments(
	templates: Record<string, string>,
	tctx: TemplateContext,
): Record<string, JsonValue> {
	return Object.fromEntries(
		Object.entries(templates).map(([name, template]) => [
			name,
			renderValue(template, tctx),
		]),
	);
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
