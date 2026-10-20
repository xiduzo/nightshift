import { describe, expect, test } from "bun:test";
import {
	type CommandNode,
	type Flow,
	flowSchema,
	nodeOutcomes,
	outputFieldsByType,
	type ToolNode,
} from "./schema";
import { parseFlow, validateFlow } from "./validate";

/** The Tool node: one MCP tool call of a Connection, with arguments from templates. */

function tool(id: string, extra: Partial<ToolNode> = {}): ToolNode {
	return {
		id,
		type: "tool",
		position: { x: 0, y: 0 },
		connection: "linear",
		tool: "create_issue",
		arguments: {},
		...extra,
	};
}

function command(id: string): CommandNode {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: "true",
		output: "text",
	};
}

function flowOf(nodes: Flow["nodes"], edges: Flow["edges"] = []): Flow {
	return {
		version: 5,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
	};
}

describe("the Tool node schema", () => {
	test("parses with its connection, tool and arguments; arguments default to none", () => {
		const parsed = flowSchema.parse({
			version: 5,
			start: "file",
			nodes: [
				{
					id: "file",
					type: "tool",
					position: { x: 0, y: 0 },
					connection: "linear",
					tool: "create_issue",
				},
			],
			edges: [],
		});
		expect(parsed.nodes[0]).toEqual(tool("file"));
	});

	test("refuses an empty tool name and a connection that is not a name", () => {
		const bad = (node: Record<string, unknown>) =>
			flowSchema.safeParse({
				version: 5,
				start: "file",
				nodes: [
					{ id: "file", type: "tool", position: { x: 0, y: 0 }, ...node },
				],
				edges: [],
			}).success;
		expect(bad({ connection: "linear", tool: "" })).toBe(false);
		expect(bad({ connection: "Linear API", tool: "create_issue" })).toBe(false);
		expect(bad({ connection: "linear", tool: "create_issue" })).toBe(true);
	});

	test("ends with pass or fail, and leaves data, text and visit for later nodes", () => {
		expect(nodeOutcomes(tool("file"))).toEqual(["pass", "fail"]);
		expect(outputFieldsByType.tool).toEqual([
			"outcome",
			"data",
			"text",
			"visit",
		]);
	});
});

describe("validateFlow: Tool", () => {
	test("a valid Tool node with template arguments has no errors", () => {
		const flow = flowOf(
			[
				command("check"),
				tool("file", {
					arguments: {
						title: "Fix {{check.log_tail}}",
						tasks: "{{plan}}",
					},
				}),
				command("done"),
			],
			[
				{ id: "e1", from: "check", outcome: "pass", to: "file" },
				{ id: "e2", from: "file", outcome: "pass", to: "done" },
			],
		);
		flow.inputs = [{ name: "plan", type: "json" }];
		const errors = validateFlow(flow).filter((i) => i.severity === "error");
		expect(errors).toEqual([]);
	});

	test("an argument that reads an unknown name or field is an error on the node", () => {
		const flow = flowOf([
			tool("file", {
				arguments: { title: "{{ghost.title}}", body: "{{file.log_tail}}" },
			}),
		]);
		expect(validateFlow(flow).filter((i) => i.severity === "error")).toEqual([
			{
				severity: "error",
				message:
					'The argument "title" of "file" uses {{ghost.title}}, but there is no node or input "ghost".',
				nodeId: "file",
			},
			{
				severity: "error",
				message:
					'The argument "body" of "file" uses {{file.log_tail}}, but "file" has no field "log_tail". Use one of: outcome, data, text, visit.',
				nodeId: "file",
			},
		]);
	});

	test("later nodes read data with a path and text without one", () => {
		const flow = flowOf(
			[tool("file"), command("report")],
			[{ id: "e1", from: "file", outcome: "pass", to: "report" }],
		);
		const ok = { ...flow };
		ok.nodes = [
			tool("file"),
			{
				...command("report"),
				command: 'echo "{{file.data.id}} {{file.text}}"',
			},
		];
		expect(validateFlow(ok).filter((i) => i.severity === "error")).toEqual([]);
		const bad = { ...flow };
		bad.nodes = [
			tool("file"),
			{ ...command("report"), command: 'echo "{{file.text.first}}"' },
		];
		expect(validateFlow(bad).filter((i) => i.severity === "error")).toEqual([
			{
				severity: "error",
				message:
					'The command of "report" uses {{file.text.first}}, but file.text is text: it takes no path.',
				nodeId: "report",
			},
		]);
	});

	test("an edge on an outcome a Tool node cannot produce is an error", () => {
		const flow = flowOf(
			[tool("file"), command("done")],
			[{ id: "e1", from: "file", outcome: "done", to: "done" }],
		);
		expect(validateFlow(flow).map((i) => i.message)).toContain(
			'Edge "e1" leaves "file" on "done", but "file" ends with pass, fail.',
		);
	});

	test("a Tool node whose tool name is blank is an error", () => {
		const { flow, issues } = parseFlow({
			version: 5,
			start: "file",
			nodes: [
				{
					id: "file",
					type: "tool",
					position: { x: 0, y: 0 },
					connection: "linear",
					tool: " ",
				},
			],
			edges: [],
		});
		expect(flow).not.toBeNull();
		expect(issues.map((i) => i.message)).toContain(
			'Tool node "file" needs the name of a tool.',
		);
	});
});
