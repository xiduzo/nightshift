import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubSubIssuesCommand, migrateFlow } from "./migrate";
import { type Flow, flowSchema } from "./schema";
import { renderCommand, templateRefs } from "./template";
import { parseFlow, validateFlow } from "./validate";

const agent = {
	type: "agent",
	position: { x: 0, y: 0 },
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
};

/** A version 1 body flow with every kind of template field. */
const v1Body = {
	version: 1,
	description: "One item",
	input: "item",
	policy: { maxSteps: 10 },
	start: "prepare",
	nodes: [
		{
			id: "prepare",
			type: "command",
			position: { x: 0, y: 0 },
			command:
				'git switch {{ item.branch }} && echo "{{item.base_branch}} {{item.index}}"',
		},
		{
			...agent,
			id: "worker",
			prompt:
				"#{{item.number}} {{item.title}} of #{{item.parent_number}} {{item.parent_title}}. Last: {{prepare.log_tail}} {{run.worktree}}",
		},
		{
			id: "decide",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Go on with {{item.parent_number}}? {{worker.summary}}",
			labels: [{ name: "go" }, { name: "halt" }],
		},
		{
			id: "ask",
			type: "gate",
			position: { x: 0, y: 0 },
			question: "Ship {{item.url}} on {{item.branch}}?",
			choices: [{ name: "ship" }],
		},
		{
			id: "subs",
			type: "foreach",
			position: { x: 0, y: 0 },
			source: {
				kind: "github",
				parent: "{{item.number}}",
				doneLabels: [],
				skipLabels: [],
			},
			flow: "leaf",
			branchPerItem: false,
			haltOn: ["halt"],
		},
		{
			id: "listed",
			type: "foreach",
			position: { x: 0, y: 0 },
			source: {
				kind: "command",
				command: "./list {{item.parent_number}} {{item.branch}}",
			},
			flow: "leaf",
		},
	],
	edges: [
		{ id: "a", from: "prepare", outcome: "pass", to: "worker" },
		{ id: "b", from: "worker", outcome: "pass", to: "decide" },
		{ id: "c", from: "decide", outcome: "go", to: "ask" },
		{ id: "d", from: "ask", outcome: "ship", to: "subs" },
		{ id: "e", from: "subs", outcome: "done", to: "listed" },
	],
};

describe("migrateFlow", () => {
	test("leaves anything that is not a version 1 object alone", () => {
		for (const value of [null, "x", 3, [1], { version: 3 }, {}]) {
			expect(migrateFlow(value)).toBe(value);
		}
	});

	test("is idempotent: a version 2 flow comes back as it is", () => {
		const once = migrateFlow(v1Body);
		expect(migrateFlow(once)).toBe(once);
		expect(migrateFlow(structuredClone(once))).toEqual(once);
	});

	test("does not change its input", () => {
		const copy = structuredClone(v1Body);
		migrateFlow(copy);
		expect(copy).toEqual(v1Body);
	});

	test("input item becomes a required json input; there are no outputs", () => {
		const flow = migrateFlow(v1Body) as Record<string, unknown>;
		expect(flow.version).toBe(2);
		expect(flow.inputs).toEqual([
			{ name: "item", type: "json", required: true },
		]);
		expect(flow.outputs).toEqual([]);
		expect(flow).not.toHaveProperty("input");
		expect(flow).not.toHaveProperty("params");
		expect(flow).toMatchObject({
			description: "One item",
			policy: { maxSteps: 10 },
			start: "prepare",
		});
		expect(Object.keys(flow)).toEqual([
			"version",
			"description",
			"inputs",
			"outputs",
			"policy",
			"start",
			"nodes",
			"edges",
		]);
	});

	test("rewrites the item fields in every template", () => {
		const flow = flowSchema.parse(migrateFlow(v1Body));
		const text = (id: string) => {
			const node = flow.nodes.find((n) => n.id === id);
			switch (node?.type) {
				case "command":
					return node.command;
				case "agent":
				case "decision":
					return node.prompt;
				case "gate":
					return node.question;
				case "foreach":
					return node.source.kind === "command" ? node.source.command : "";
				default:
					throw new Error(`no node ${id}`);
			}
		};
		expect(text("prepare")).toBe(
			'git switch {{run.branch}} && echo "{{run.base_branch}} {{run.index}}"',
		);
		expect(text("worker")).toBe(
			"#{{item.number}} {{item.title}} of #{{item.parent.number}} {{item.parent.title}}. Last: {{prepare.log_tail}} {{run.worktree}}",
		);
		expect(text("decide")).toBe(
			"Go on with {{item.parent.number}}? {{worker.summary}}",
		);
		expect(text("ask")).toBe("Ship {{item.url}} on {{run.branch}}?");
		// The GitHub source became a command on gh: the parent is its issue number.
		expect(text("subs")).toContain(`-F number="{{item.number}}"`);
		expect(text("listed")).toBe("./list {{item.parent.number}} {{run.branch}}");
	});

	test("For Each: branchPerItem becomes branch, as is item", () => {
		const flow = flowSchema.parse(migrateFlow(v1Body));
		const [subs, listed] = flow.nodes.filter((n) => n.type === "foreach");
		expect(subs).toMatchObject({ branch: "shared", as: "item", inputs: {} });
		expect(listed).toMatchObject({ branch: "per-item", as: "item" });
		expect(subs).not.toHaveProperty("branchPerItem");
	});

	test("params become text inputs; {{params.x}} becomes {{x}}", () => {
		const flow = migrateFlow({
			version: 1,
			params: [
				{ name: "epic", label: "Epic", required: true },
				{ name: "base", default: "main" },
			],
			start: "worker",
			nodes: [
				{
					...agent,
					id: "worker",
					prompt: "Epic {{ params.epic }} on {{params.base}}",
				},
			],
			edges: [],
		});
		expect(flow).toMatchObject({
			version: 2,
			inputs: [
				{ name: "epic", label: "Epic", required: true, type: "text" },
				{ name: "base", default: "main", type: "text" },
			],
			nodes: [{ prompt: "Epic {{epic}} on {{base}}" }],
		});
	});

	test("a body that read a param it did not declare takes it as an input", () => {
		const flow = migrateFlow({
			...v1Body,
			nodes: [{ ...agent, id: "worker", prompt: "Epic {{params.epic}}" }],
			edges: [],
			start: "worker",
		});
		expect(flow).toMatchObject({
			inputs: [
				{ name: "item", type: "json", required: true },
				{ name: "epic", type: "text", required: true },
			],
		});
	});

	test("the migrated flow parses and validates", () => {
		const leaf = parseFlow({
			version: 1,
			input: "item",
			start: "worker",
			nodes: [{ ...agent, id: "worker", prompt: "{{item.title}}" }],
			edges: [],
		});
		expect(leaf.issues).toEqual([]);
		const parsed = parseFlow(v1Body, {
			flows: { leaf: leaf.flow },
			name: "body",
		});
		expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
	});
});

describe("the rpgdotexe night, as version 1", () => {
	// The files as they were before they moved to version 2, kept here so
	// the migration stays tested after the examples changed on disk.
	const dir = join(import.meta.dir, "fixtures", "v1-rpgdotexe");
	const names = ["night", "feature", "trace"] as const;
	const raw = Object.fromEntries(
		names.map((name) => [
			name,
			JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as unknown,
		]),
	);
	const parsed = Object.fromEntries(
		names.map((name) => [name, parseFlow(raw[name])]),
	);
	const flows: Record<string, Flow | null> = Object.fromEntries(
		names.map((name) => [name, parsed[name]?.flow ?? null]),
	);

	test("the fixtures are version 1", () => {
		for (const name of names) {
			expect((raw[name] as { version: number }).version).toBe(1);
		}
	});

	for (const name of names) {
		test(`${name}.json migrates and validates with no errors, together`, () => {
			expect(parsed[name]?.flow).not.toBeNull();
			const flow = flows[name];
			if (!flow) throw new Error(`${name} does not parse`);
			const errors = validateFlow(flow, { flows, name }).filter(
				(issue) => issue.severity === "error",
			);
			expect(errors).toEqual([]);
		});
	}

	test("no version 1 references are left", () => {
		for (const name of names) {
			const flow = flows[name];
			if (!flow) throw new Error(`${name} does not parse`);
			const text = JSON.stringify(flow.nodes);
			expect(text).not.toContain("params.");
			expect(text).not.toContain("item.parent_");
			expect(text).not.toContain("item.branch");
			expect(text).not.toContain("item.base_branch");
		}
	});

	test("the night takes the Epic; the bodies take their element", () => {
		expect(flows.night?.inputs).toEqual([
			{
				name: "epic",
				type: "text",
				label: "Epic",
				description:
					"The issue number of the Epic to build, as in night-shift.py <epic>.",
				required: true,
			},
		]);
		expect(flows.night?.nodes[0]).toMatchObject({
			type: "foreach",
			source: {
				kind: "command",
				command: githubSubIssuesCommand({
					parent: "{{epic}}",
					requireLabel: "feature",
					doneLabels: [],
					skipLabels: [],
				}),
			},
			as: "item",
			branch: "shared",
		});
		expect(JSON.stringify(flows)).not.toContain('"github"');
		expect(flows.feature?.inputs).toEqual([
			{ name: "item", type: "json", required: true },
		]);
		expect(
			flows.feature?.nodes.find((node) => node.id === "traces"),
		).toMatchObject({ branch: "per-item", as: "item" });
		const deliver = flows.trace?.nodes.find((node) => node.id === "deliver");
		const refs =
			deliver?.type === "command"
				? templateRefs(deliver.command).map((ref) => ref.raw)
				: [];
		expect(refs).toContain("{{run.base_branch}}");
		expect(refs).toContain("{{item.parent.number}}");
	});
});

describe("migrateFlow: tool sets", () => {
	const current = (nodes: unknown[]) => ({
		version: 2,
		inputs: [],
		outputs: [],
		start: "work",
		nodes,
		edges: [],
	});

	test("the github tool set becomes the CLI tool gh", () => {
		const migrated = migrateFlow(
			current([
				{ ...agent, id: "work", prompt: "Go", tools: ["github"] },
				{ ...agent, id: "more", prompt: "Go", tools: ["github"], clis: ["gh"] },
				{ ...agent, id: "none", prompt: "Go", tools: [] },
				{
					id: "decide",
					type: "decision",
					position: { x: 0, y: 0 },
					prompt: "Go on?",
					labels: [{ name: "yes" }, { name: "no" }],
					tools: ["github"],
				},
			]),
		) as { nodes: Record<string, unknown>[] };
		expect(migrated.nodes.map((n) => [n.tools, n.clis])).toEqual([
			[undefined, ["gh"]],
			[undefined, ["gh"]],
			[undefined, undefined],
			[undefined, undefined],
		]);
		expect(flowSchema.safeParse(migrated).success).toBe(true);
	});

	test("a flow without tool sets stays the same object", () => {
		const flow = current([{ ...agent, id: "work", prompt: "Go" }]);
		expect(migrateFlow(flow)).toBe(flow);
	});

	test("version 1 tool sets migrate too", () => {
		const migrated = migrateFlow({
			...v1Body,
			nodes: [{ ...agent, id: "prepare", prompt: "Go", tools: ["github"] }],
			edges: [],
		}) as { nodes: Record<string, unknown>[] };
		expect(migrated.nodes[0]?.clis).toEqual(["gh"]);
	});
});

describe("migrateFlow: list sources", () => {
	const current = (source: unknown, extra: Record<string, unknown> = {}) => ({
		version: 2,
		inputs: [{ name: "epic", type: "text", required: true }],
		outputs: [],
		start: "each",
		nodes: [
			{
				id: "each",
				type: "foreach",
				position: { x: 0, y: 0 },
				source,
				flow: "trace",
				as: "item",
				inputs: {},
				branch: "shared",
				haltOn: ["halt"],
				...extra,
			},
		],
		edges: [],
	});

	test("a github source becomes a command on gh with the same filters", () => {
		const migrated = migrateFlow(
			current({
				kind: "github",
				parent: "{{epic}}",
				requireLabel: "Feature",
				doneLabels: ["Done", "shipped"],
				skipLabels: ["draft"],
			}),
		) as { nodes: { source: unknown }[] };
		const expected = githubSubIssuesCommand({
			parent: "{{epic}}",
			requireLabel: "Feature",
			doneLabels: ["Done", "shipped"],
			skipLabels: ["draft"],
		});
		expect(migrated.nodes[0]?.source).toEqual({
			kind: "command",
			command: expected,
		});
		expect(expected).toContain(`-F number="{{epic}}"`);
		expect(expected).toContain("-F owner='{owner}' -F name='{repo}'");
		expect(expected).toContain("subIssues(first: 100)");
		expect(expected).toContain("blockedBy(first: 50)");
		expect(expected).toContain(
			`"feature" as $require | ["draft"] as $skip | ["done","shipped"] as $done`,
		);
		expect(expected).not.toMatch(/mutation/);
		expect(flowSchema.safeParse(migrated).success).toBe(true);
		expect(validateFlow(flowSchema.parse(migrated))).toEqual([]);
	});

	test("without filters the knobs are null and empty; a label's quote is escaped for the shell", () => {
		const bare = githubSubIssuesCommand({ parent: "7" });
		expect(bare).toContain("null as $require | [] as $skip | [] as $done");
		expect(bare).toContain(`-F number="7"`);
		const quoted = githubSubIssuesCommand({
			parent: "7",
			doneLabels: ["won't fix"],
		});
		expect(quoted).toContain(`["won'\\''t fix"] as $done`);
	});

	test("other sources and nodes stay the same object", () => {
		for (const flow of [
			current({ kind: "command", command: "cat tasks.json" }),
			current({ kind: "json", value: "{{plan.data.tasks}}" }),
			current({ kind: "files", glob: "*.md" }),
		]) {
			expect(migrateFlow(flow)).toBe(flow);
		}
	});

	const jq = Bun.which("jq");
	test.skipIf(!jq)(
		"the command prints the same items the engine's reader gave",
		() => {
			// A fake gh: it answers `api graphql --jq FILTER` with one page through jq.
			const dir = mkdtempSync(join(tmpdir(), "nightshift-gh-"));
			const page = join(dir, "page.json");
			const log = join(dir, "fields.txt");
			const issue = (
				number: number,
				labels: string[],
				extra: Record<string, unknown> = {},
			) => ({
				number,
				title: `Trace ${number}`,
				body: `Body of ${number}`,
				state: "OPEN",
				url: `https://github.com/acme/game/issues/${number}`,
				labels: { nodes: labels.map((name) => ({ name })) },
				blockedBy: { nodes: [] },
				...extra,
			});
			writeFileSync(
				page,
				JSON.stringify({
					data: {
						repository: {
							issue: {
								number: 10,
								title: "Feature: combat",
								subIssues: {
									nodes: [
										issue(11, ["trace"]),
										issue(12, ["Trace", "Implemented"], {
											body: null,
											blockedBy: {
												nodes: [
													{ number: 11, state: "OPEN" },
													{ number: 3, state: "CLOSED" },
												],
											},
										}),
										issue(13, ["trace", "Draft"]),
										issue(14, ["bug"], { state: "CLOSED" }),
									],
								},
							},
						},
					},
				}),
			);
			writeFileSync(
				join(dir, "gh"),
				[
					"#!/bin/sh",
					'filter=""',
					"while [ $# -gt 0 ]; do",
					'  case "$1" in',
					'    --jq) filter="$2"; shift ;;',
					`    -F|-f) printf '%s\\n' "$2" >> '${log}'; shift ;;`,
					"  esac",
					"  shift",
					"done",
					`exec '${jq}' "$filter" < '${page}'`,
					"",
				].join("\n"),
			);
			chmodSync(join(dir, "gh"), 0o755);

			const text = githubSubIssuesCommand({
				parent: "{{item.number}}",
				requireLabel: "trace",
				doneLabels: ["implemented"],
				skipLabels: ["draft"],
			});
			const { command, env } = renderCommand(text, {
				run: {
					flow: "feature",
					branch: "",
					base_branch: "",
					index: "",
					worktree: "",
					base_ref: "",
				},
				inputs: { item: { number: 10 } },
				nodes: {},
			});
			const result = Bun.spawnSync(["sh", "-c", command], {
				env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}` },
			});
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
			const parent = { number: 10, title: "Feature: combat" };
			expect(JSON.parse(result.stdout.toString())).toEqual([
				{
					id: "11",
					number: 11,
					title: "Trace 11",
					body: "Body of 11",
					url: "https://github.com/acme/game/issues/11",
					state: "OPEN",
					labels: ["trace"],
					parent,
					dependsOn: [],
					done: false,
				},
				{
					id: "12",
					number: 12,
					title: "Trace 12",
					body: "",
					url: "https://github.com/acme/game/issues/12",
					state: "OPEN",
					labels: ["Trace", "Implemented"],
					parent,
					dependsOn: [
						{ id: "11", done: false },
						{ id: "3", done: true },
					],
					done: true,
				},
			]);
			const fields = readFileSync(log, "utf8").split("\n");
			expect(fields.slice(0, 3)).toEqual([
				"owner={owner}",
				"name={repo}",
				"number=10",
			]);
			expect(fields[3]).toStartWith("query=");
		},
	);
});
