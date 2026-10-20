import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { harnessFacts } from "@nightshift/agents/harness-facts";
import { fixturePath } from "@nightshift/agents/testing";
import type { McpServerConfig } from "@nightshift/agents/types";
import type { ToolNode } from "@nightshift/flows";
import { coerceArguments } from "../device/tool-call";
import { readTranscriptFile } from "../log/transcripts";
import { deriveSteps } from "../read/derive-steps";
import {
	command,
	drive,
	edge,
	flowOf,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { dataOf } from "./nodes/tool";

/**
 * The Tool node on the compiled graph, against the fake stdio MCP server
 * of `@nightshift/agents/testing` (`fake-mcp.ts`), with a real run log
 * and MemorySaver.
 */

const fakeMcp: McpServerConfig = {
	command: process.execPath,
	args: [fixturePath("fake-mcp.ts")],
	env: {},
};

const tool = (
	id: string,
	name: string,
	args: Record<string, string> = {},
	extra: Partial<ToolNode> = {},
): ToolNode => ({
	id,
	type: "tool",
	position: { x: 0, y: 0 },
	connection: "tracker",
	tool: name,
	arguments: args,
	...extra,
});

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** A run whose `tracker` connection is the fake server. */
async function start(
	flow: Parameters<typeof startRun>[1],
	options: Parameters<typeof startRun>[2] = {},
) {
	const h = await startRun(sandbox, flow, {
		harness: fakeHarness(),
		...options,
	});
	h.local.mcpServersFor = async (node) =>
		(node.connections ?? []).includes("tracker")
			? { ok: true, servers: { tracker: fakeMcp } }
			: {
					ok: false,
					message: `There is no connection named "${node.connections?.[0]}". Add it under Agents → Tools, or remove it from the node.`,
				};
	return h;
}

function fakeHarness() {
	return {
		name: "claude-code" as const,
		...harnessFacts("claude-code"),
		run: async function* () {
			yield { type: "finished" as const };
		},
	};
}

describe("the Tool node", () => {
	test("passes with the tool's structured content as data, and the log, transcript and state as a step writes them", async () => {
		const h = await start(
			flowOf(
				[
					tool("file", "create_issue", {
						title: "Fix {{task}}",
						teamId: "{{team}}",
					}),
					command("done", "true"),
				],
				[edge("e1", "file", "pass", "done")],
				{ inputs: [{ name: "task" }, { name: "team" }] },
			),
			{ inputs: { task: "the build", team: "T1" } },
		);
		const { parked, events, state } = await drive(h, {
			inputs: { task: "the build", team: "T1" },
		});
		expect(parked).toEqual([]);
		expect(state.ended).toMatchObject({ status: "finished", nodeId: "done" });
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
		]);

		const logged = await h.events();
		expect(payloads(logged, "StepStarted")[0]).toMatchObject({
			nodeId: "file",
			nodeType: "tool",
			visit: 1,
			logPath: null,
			scope: null,
		});
		const issue = {
			id: "ISS-1",
			title: "Fix the build",
			url: "https://tracker.example/ISS-1",
		};
		expect(payloads(logged, "StepEnded")[0]).toEqual({
			outcome: "pass",
			outputs: {
				outcome: "pass",
				data: issue,
				text: "Created ISS-1",
				visit: 1,
			},
			error: null,
		});
		expect(state.nodes.file).toEqual({
			outcome: "pass",
			data: issue,
			text: "Created ISS-1",
			visit: 1,
		});

		const [step] = deriveSteps(logged);
		const transcript = await readTranscriptFile(step?.transcriptPath as string);
		expect(transcript.map((e) => e.event)).toEqual([
			{
				type: "tool-call",
				connection: "tracker",
				tool: "create_issue",
				arguments: { title: "Fix the build", teamId: "T1" },
			},
			{
				type: "tool-called",
				isError: false,
				text: "Created ISS-1",
				data: issue,
			},
		]);
		expect(transcript.every((e) => e.sessionId === null)).toBe(true);
		expect(events.map((e) => e.type)).toEqual([
			"step-started",
			"transcript",
			"transcript",
			"step-ended",
			"step-started",
			"transcript",
			"transcript",
			"step-ended",
		]);
	});

	test("text that is JSON becomes data; plain text leaves data null", async () => {
		const h = await start(
			flowOf(
				[
					tool("list", "list_json", { count: "3" }),
					tool("say", "say", { text: "hi" }),
				],
				[edge("e1", "list", "pass", "say")],
			),
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.nodes.list).toEqual({
			outcome: "pass",
			data: [{ n: 1 }, { n: 2 }, { n: 3 }],
			text: '[{"n":1},{"n":2},{"n":3}]',
			visit: 1,
		});
		expect(state.nodes.say).toEqual({
			outcome: "pass",
			data: null,
			text: "You said: hi\nBye.",
			visit: 1,
		});
	});

	test("one reference keeps its JSON value, and the tool's schema types the other text", async () => {
		const h = await start(
			flowOf(
				[
					tool("typed", "typed", {
						name: "{{count}}",
						count: "{{count}}",
						whole: "4",
						flag: "true",
						tags: "{{tags}}",
						meta: '{"k": {{count}}}',
					}),
				],
				[],
				{
					inputs: [
						{ name: "count", type: "json" },
						{ name: "tags", type: "json" },
					],
				},
			),
		);
		const { state } = await drive(h, {
			inputs: { count: 2.5, tags: ["a", "b"] },
		});
		expect(state.nodes.typed?.data).toEqual({
			types: {
				name: "string",
				count: "number",
				whole: "number",
				flag: "boolean",
				tags: "array",
				meta: "object",
			},
			args: {
				name: "2.5",
				count: 2.5,
				whole: 4,
				flag: true,
				tags: ["a", "b"],
				meta: { k: 2.5 },
			},
		});
	});

	test("a result with isError fails, with the text as the step's error, and takes the fail edge", async () => {
		const h = await start(
			flowOf(
				[
					tool("file", "fail", { reason: "No such team." }),
					command("fixed", "true"),
				],
				[edge("e1", "file", "fail", "fixed")],
			),
		);
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("fixed");
		expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
			outcome: "fail",
			outputs: {
				outcome: "fail",
				data: null,
				text: "No such team.",
				visit: 1,
			},
			error: "No such team.",
		});
		const [step] = deriveSteps(await h.events());
		const transcript = await readTranscriptFile(step?.transcriptPath as string);
		expect(transcript.at(-1)?.event).toEqual({
			type: "tool-called",
			isError: true,
			text: "No such team.",
			data: null,
		});
	});

	test("a tool the connection does not have fails, naming the tools it has", async () => {
		const h = await start(flowOf([tool("file", "close_issue", { id: "1" })]));
		const { parked } = await drive(h, { inputs: {} });
		const message =
			'The connection "tracker" has no tool named "close_issue". It has: create_issue, fail, list_json, say, slow, typed, whoami.';
		expect(parked[0]).toMatchObject({
			kind: "parked",
			status: "failed",
			reason: `Node "file" ended with "fail" and no edge leaves it on that outcome.`,
		});
		expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
			outcome: "fail",
			outputs: { outcome: "fail", data: null, text: "", visit: 1 },
			error: message,
		});
		const [step] = deriveSteps(await h.events());
		const transcript = await readTranscriptFile(step?.transcriptPath as string);
		expect(transcript.map((e) => e.event)).toEqual([
			{
				type: "tool-call",
				connection: "tracker",
				tool: "close_issue",
				arguments: { id: "1" },
			},
			{ type: "tool-called", isError: true, text: message, data: null },
		]);
	});

	test("a server that cannot be reached fails the step with a readable error", async () => {
		const h = await start(flowOf([tool("file", "say", { text: "hi" })]));
		h.local.mcpServersFor = async () => ({
			ok: true,
			servers: {
				tracker: { command: "/nonexistent/mcp-server", args: [], env: {} },
			},
		});
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({ status: "failed" });
		const [ended] = payloads(await h.events(), "StepEnded");
		expect(ended?.outcome).toBe("fail");
		expect(ended?.error).toStartWith(
			'The connection "tracker" did not answer: ',
		);
	});

	test("a connection the resolver does not have ends the step with its message", async () => {
		const h = await start(
			flowOf([tool("file", "say", { text: "hi" }, { connection: "ghost" })]),
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({
			status: "failed",
			reason:
				'Node "file" failed: There is no connection named "ghost". Add it under Agents → Tools, or remove it from the node.',
		});
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "error",
			outputs: { outcome: "error", data: null, text: "", visit: 1 },
		});
	});

	test("a stop while the tool runs ends the step stopped and parks the run", async () => {
		const controller = new AbortController();
		const h = await start(flowOf([tool("slow", "slow", { ms: "30000" })]), {
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(), 400);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({ status: "stopped", reason: null });
		expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
			outcome: "stopped",
			outputs: { outcome: "stopped", data: null, text: "", visit: 1 },
			error: null,
		});
	});
});

describe("the Tool node's helpers", () => {
	test("dataOf: structured content first, then JSON text, else null", () => {
		expect(
			dataOf({ text: "x", structuredContent: { a: 1 }, isError: false }),
		).toEqual({ a: 1 });
		expect(
			dataOf({ text: ' {"a": 1} ', structuredContent: null, isError: false }),
		).toEqual({ a: 1 });
		expect(
			dataOf({ text: "42", structuredContent: null, isError: false }),
		).toBe(42);
		expect(
			dataOf({ text: "not json", structuredContent: null, isError: false }),
		).toBeNull();
		expect(
			dataOf({ text: "", structuredContent: null, isError: false }),
		).toBeNull();
	});

	test("coerceArguments reads text as the schema's type, and leaves the rest", () => {
		const schema = {
			type: "object",
			properties: {
				n: { type: "number" },
				i: { type: "integer" },
				b: { type: "boolean" },
				o: { type: "object" },
				a: { type: "array" },
				s: { type: "string" },
				u: {},
				m: { type: ["string", "number"] },
				e: { anyOf: [{ type: "integer" }, { type: "null" }] },
			},
		};
		expect(
			coerceArguments(
				{
					n: "1.5",
					i: "2",
					b: "false",
					o: '{"k":1}',
					a: "[1]",
					s: "3",
					u: "4",
					m: "5",
					e: "null",
					extra: "6",
					already: 7,
				},
				schema,
			),
		).toEqual({
			n: 1.5,
			i: 2,
			b: false,
			o: { k: 1 },
			a: [1],
			s: "3",
			u: "4",
			m: "5",
			e: null,
			extra: "6",
			already: 7,
		});
		// Text that does not read as the type stays text: the server says why.
		expect(
			coerceArguments(
				{ n: "many", i: "2.5", b: "yes", o: "[1]", a: "{}" },
				schema,
			),
		).toEqual({ n: "many", i: "2.5", b: "yes", o: "[1]", a: "{}" });
		expect(coerceArguments({ n: "1" }, { type: "object" })).toEqual({ n: "1" });
		// A number or a boolean from a reference becomes text for a text property.
		expect(coerceArguments({ s: 3, m: 4, o: 5, extra: true }, schema)).toEqual({
			s: "3",
			m: 4,
			o: 5,
			extra: true,
		});
	});
});
