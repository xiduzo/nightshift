import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Flow, flowSchema } from "@nightshift/flows";
import {
	cell,
	communityFlows,
	communityTable,
	fill,
	firstColumnNames,
	flowNeeds,
	loadCommunityFlow,
	needsList,
	table,
} from "./docs-reference";

const generated = { kits: () => table(["Kit"], [["`kit:a`"]]) };
const checked = { nodes: () => ["Agent", "Wait"] };

/** A flow file of one Command node, with `extra` on the node. */
function commandFile(
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		version: 8,
		description: "Says hello.",
		start: "hello",
		nodes: [
			{
				id: "hello",
				type: "command",
				position: { x: 0, y: 0 },
				command: "echo hello",
				...extra,
			},
		],
		edges: [],
	};
}

const fileOf = (json: unknown) => JSON.stringify(json, null, "\t");

describe("fill", () => {
	test("writes a generated block and keeps its markers", () => {
		const text = [
			"Before.",
			"<!-- generated:kits: do not edit. -->",
			"old",
			"<!-- /generated:kits -->",
			"After.",
		].join("\n");
		const { text: filled, problems } = fill(text, generated, checked);
		expect(problems).toEqual([]);
		expect(filled).toBe(
			[
				"Before.",
				"<!-- generated:kits: do not edit. -->",
				"| Kit |",
				"| --- |",
				"| `kit:a` |",
				"<!-- /generated:kits -->",
				"After.",
			].join("\n"),
		);
	});

	test("fills an empty generated block", () => {
		const text = "<!-- generated:kits -->\n<!-- /generated:kits -->";
		const { text: filled } = fill(text, generated, checked);
		expect(filled).toBe(
			"<!-- generated:kits -->\n| Kit |\n| --- |\n| `kit:a` |\n<!-- /generated:kits -->",
		);
	});

	test("leaves a checked table as it is, and names what it misses and adds", () => {
		const text = [
			"<!-- checked:nodes -->",
			"| Node | Does |",
			"| --- | --- |",
			"| **Agent** | Works. |",
			"| **Lease** | Waits. |",
			"<!-- /checked:nodes -->",
		].join("\n");
		const { text: filled, problems } = fill(text, generated, checked);
		expect(filled).toBe(text);
		expect(problems).toEqual([
			{ block: "checked:nodes", message: "misses Wait." },
			{
				block: "checked:nodes",
				message: "names Lease, which the code does not have.",
			},
		]);
	});

	test("names a block without a generator", () => {
		const text = "<!-- generated:nope -->\nx\n<!-- /generated:nope -->";
		const { text: filled, problems } = fill(text, generated, checked);
		expect(filled).toBe(text);
		expect(problems).toEqual([
			{ block: "generated:nope", message: "has no generator. Check its name." },
		]);
	});

	test("gives a generator the path of the file it fills", () => {
		const text = "<!-- generated:here -->\n<!-- /generated:here -->";
		const here = { here: (file: string) => `In ${file}.` };
		const { text: filled } = fill(text, here, checked, "/repo/a/README.md");
		expect(filled).toBe(
			"<!-- generated:here -->\nIn /repo/a/README.md.\n<!-- /generated:here -->",
		);
	});

	test("keeps the block of a generator that throws, and names its message", () => {
		const text = "<!-- generated:needs -->\nold\n<!-- /generated:needs -->";
		const throws = {
			needs: () => {
				throw new Error("needs a flow.json next to it.");
			},
		};
		const { text: filled, problems } = fill(text, throws, checked);
		expect(filled).toBe(text);
		expect(problems).toEqual([
			{ block: "generated:needs", message: "needs a flow.json next to it." },
		]);
	});
});

describe("flowNeeds", () => {
	test("lists each kind a flow needs once, each tier of a cascade on its own", () => {
		const flow: Flow = flowSchema.parse({
			version: 8,
			start: "build",
			nodes: [
				{
					id: "build",
					type: "agent",
					position: { x: 0, y: 0 },
					prompt: "Build it.",
					permissionMode: "auto",
					clis: ["gh"],
					connections: ["linear"],
					cascade: [
						{ harness: "claude-code", model: "sonnet", tries: 2 },
						{ harness: "claude-code", model: "opus", clis: ["gh", "jq"] },
						{ person: true },
					],
				},
				{
					id: "read",
					type: "tool",
					position: { x: 0, y: 0 },
					connection: "figma",
					tool: "get_design_context",
				},
				{
					id: "pick",
					type: "decision",
					position: { x: 0, y: 0 },
					prompt: "Which one?",
					by: "model",
					decider: "ollama",
					model: "qwen3",
					options: [{ name: "a" }, { name: "b" }],
				},
				{
					id: "send",
					type: "command",
					position: { x: 0, y: 0 },
					command: 'curl -H "Authorization: $API_TOKEN" example.com',
					secrets: ["API_TOKEN"],
				},
				{
					id: "branch",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "kit:github/create-branch",
				},
				{
					id: "again",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "implement-and-check",
				},
			],
			edges: [],
		});
		expect(needsList(flowNeeds(flow))).toBe(
			[
				"- Agents: Claude Code · `sonnet`, Claude Code · `opus`",
				"- Models: `ollama` · `qwen3`",
				"- CLI tools: `gh`, `jq`",
				// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
				"- Secrets: `${API_TOKEN}`",
				"- Connections (MCP servers): `linear`, `figma`",
				"- Kits: `kit:github/create-branch`",
				"- Flows it calls: `implement-and-check`",
			].join("\n"),
		);
	});

	test("a flow of commands without secrets needs Night Shift only", () => {
		const flow = flowSchema.parse(commandFile());
		expect(flowNeeds(flow)).toEqual([]);
		expect(needsList([])).toBe("- Night Shift only.");
	});
});

describe("loadCommunityFlow", () => {
	test("loads a flow that passes the check of a save", () => {
		const { flow, problems } = loadCommunityFlow(
			"hello",
			fileOf(commandFile()),
		);
		expect(problems).toEqual([]);
		expect(flow?.description).toBe("Says hello.");
	});

	test("migrates a file of an older format, as an import does", () => {
		const { flow, problems } = loadCommunityFlow(
			"hello",
			fileOf({ ...commandFile(), version: 6 }),
		);
		expect(problems).toEqual([]);
		expect(flow?.version).toBe(8);
	});

	test("names a file that is not JSON, or of a newer format", () => {
		expect(loadCommunityFlow("a", "{ nope").problems[0]).toStartWith(
			"It is not valid JSON",
		);
		expect(
			loadCommunityFlow("a", fileOf({ ...commandFile(), version: 99 })),
		).toEqual({
			name: "a",
			flow: null,
			problems: ["Its format is 99, and Night Shift reads up to format 8."],
		});
	});

	test("gives the errors of the check a save makes", () => {
		const file = { ...commandFile(), start: "ghost" };
		const { flow, problems } = loadCommunityFlow("a", fileOf(file));
		expect(flow).toBeNull();
		expect(problems.length).toBeGreaterThan(0);
		expect(problems.join(" ")).toContain("ghost");
	});

	test("refuses a user's own folder and the Keychain", () => {
		const problemsOf = (command: string) =>
			loadCommunityFlow("a", fileOf(commandFile({ command }))).problems;
		expect(problemsOf("cat /Users/me/notes.md")).toEqual([
			"It names a folder of one user (/Users/ or /home/). Use a path in the project.",
		]);
		expect(problemsOf("cat /home/me/notes.md")).toHaveLength(1);
		expect(problemsOf("~/bin/deploy")).toEqual([
			"It names a home folder (~/). Use a path in the project.",
		]);
		expect(problemsOf("security find-generic-password -s figma -w")).toEqual([
			"It reads the Keychain. Name a secret in the secrets of the Command node instead.",
		]);
		expect(problemsOf("echo hello")).toEqual([]);
	});
});

describe("communityFlows", () => {
	test("reads each folder with a flow.json, and checks the flows each one calls", () => {
		const dir = mkdtempSync(join(tmpdir(), "community-"));
		const add = (name: string, json: unknown) => {
			mkdirSync(join(dir, name));
			writeFileSync(join(dir, name, "flow.json"), fileOf(json));
		};
		const caller = (flow: string) => ({
			version: 8,
			start: "call",
			nodes: [
				{
					id: "call",
					type: "call",
					position: { x: 0, y: 0 },
					flow,
					inputs: { task: "Fix it." },
				},
			],
			edges: [],
		});
		add("hello", commandFile());
		add("calls-starter", caller("implement-and-check"));
		add("calls-ghost", caller("ghost"));
		mkdirSync(join(dir, "notes"));

		const flows = communityFlows(dir);
		expect(flows.map((flow) => flow.name)).toEqual([
			"calls-ghost",
			"calls-starter",
			"hello",
		]);
		expect(flows[0]?.problems.join(" ")).toContain("ghost");
		expect(flows[1]?.problems).toEqual([]);
		expect(flows[2]?.problems).toEqual([]);
	});

	test("every flow of community/ loads without a problem", () => {
		const flows = communityFlows();
		expect(flows.length).toBeGreaterThan(0);
		for (const { name, problems } of flows) {
			expect({ name, problems }).toEqual({ name, problems: [] });
		}
	});
});

describe("communityTable", () => {
	test("links each flow to its folder, and leaves out one that does not load", () => {
		const flow = flowSchema.parse(commandFile());
		expect(
			communityTable([
				{ name: "hello", flow, problems: [] },
				{ name: "broken", flow: null, problems: ["It is not valid JSON."] },
			]),
		).toBe(
			[
				"| Flow | Does | Needs |",
				"| --- | --- | --- |",
				"| [`hello`](https://github.com/xiduzo/nightshift/tree/main/community/hello) | Says hello. | Night Shift only. |",
			].join("\n"),
		);
	});
});

describe("firstColumnNames", () => {
	test("reads every code or bold name of the first cell, after the header", () => {
		const body = [
			"| Tool | Does |",
			"| --- | --- |",
			"| `list_flows`, `get_flow` | Read. A `pipe` here does not count. |",
			"| **Gate** \\| person | Waits. |",
		].join("\n");
		expect(firstColumnNames(body)).toEqual(["list_flows", "get_flow", "Gate"]);
	});
});

describe("cell", () => {
	test("keeps a table cell on one line and escapes a pipe", () => {
		expect(cell("a | b\nc  d")).toBe("a \\| b c d");
	});
});
