import type { McpToolCall } from "@nightshift/agents/mcp";
import {
	type JsonValue,
	renderValue,
	type TemplateContext,
	type ToolNode,
} from "@nightshift/flows";

import type { StepOutputs } from "../../events";
import {
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { type BodyResult, runStep, type StepHandle } from "../step-runner";

/**
 * The Tool node: one `tools/call` on a Connection's MCP server, with no
 * model in the loop, on the step's Device (`Device.callTool`): the Device
 * resolves the Connection as it does for an Agent node, so `${NAME}`
 * secrets are filled the same way and reach the client only. It connects,
 * lists the tools (an unknown tool is `fail`, and the tool's input schema
 * types the arguments), calls and disconnects; the step records the call
 * and the answer. `pass` when the tool answered without `isError`; `fail` on
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
			rules: TOOL.resumeRules(node),
			body: (step) => callTool(node, step),
		});
}

/**
 * The Tool kind: the plain facts, plus the one connection the daemon must
 * have. No wait node: a transport failure is `fail`.
 */
export const TOOL: NodeKind<ToolNode> = {
	...PLAIN_KIND,
	type: "tool",
	make: toolNode,
	works: () => "device",
	// A wait node: the step sleeps while its Device is offline.
	aux: () => [{ kind: "wait" }],
	resumeRules: () => RESUME_RULES.fresh,
	connections: (node) => [node.connection],
};

async function callTool(node: ToolNode, step: StepHandle): Promise<BodyResult> {
	const { visit, signal } = step;
	const empty: StepOutputs = { visit, data: null, text: "" };
	const end = (
		outcome: string,
		outputs: StepOutputs,
		error: string | null,
	): BodyResult => ({ kind: "end", outcome, outputs, error });

	const rendered = renderArguments(node.arguments, step.tctx);
	const result = await step.device.callTool({
		connection: node.connection,
		tool: node.tool,
		arguments: rendered,
		signal,
	});
	if (result.kind === "refused") return end("error", empty, result.message);
	// Every Tool step records the call, then its answer.
	const recordCall = (args: Record<string, JsonValue>) =>
		step.record(null, {
			type: "tool-call",
			connection: node.connection,
			tool: node.tool,
			arguments: args,
		});
	if (result.kind === "failed") {
		if (signal.aborted) {
			if (result.arguments) recordCall(result.arguments);
			return { kind: "aborted", outputs: empty };
		}
		recordCall(result.arguments ?? rendered);
		step.record(null, {
			type: "tool-called",
			isError: true,
			text: result.message,
			data: null,
		});
		return end("fail", empty, result.message);
	}

	recordCall(result.arguments);
	const data = dataOf(result);
	step.record(null, {
		type: "tool-called",
		isError: result.isError,
		text: result.text,
		data,
	});
	const outputs: StepOutputs = { ...empty, data, text: result.text };
	if (signal.aborted) return { kind: "aborted", outputs };
	return end(
		result.isError ? "fail" : "pass",
		outputs,
		result.isError ? result.text || "The tool reported an error." : null,
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
