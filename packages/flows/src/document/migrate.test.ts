import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubSubIssuesCommand } from "../recipes";
import { renderCommand, templateRefs } from "../template";
import { parseFlow, validateFlow } from "../validate";
import { type Flow, flowSchema } from "./flow";
import { migrateFlow } from "./migrate";

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
		for (const value of [null, "x", 3, [1], { version: 6 }, {}]) {
			expect(migrateFlow(value)).toBe(value);
		}
	});

	test("is idempotent: a current flow comes back as it is", () => {
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
		expect(flow.version).toBe(6);
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
				case "call":
					return node.each?.source.kind === "command"
						? node.each.source.command
						: "";
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

	test("For Each: branchPerItem becomes branch, as is item, all under each", () => {
		const flow = flowSchema.parse(migrateFlow(v1Body));
		const [subs, listed] = flow.nodes.filter((n) => n.type === "call");
		expect(subs).toMatchObject({
			inputs: {},
			each: { branch: "shared", as: "item" },
		});
		expect(listed).toMatchObject({ each: { branch: "per-item", as: "item" } });
		expect(subs).not.toHaveProperty("branchPerItem");
		expect(subs).not.toHaveProperty("source");
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
			version: 6,
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
			type: "call",
			each: {
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
			},
		});
		expect(JSON.stringify(flows)).not.toContain('"github"');
		expect(flows.feature?.inputs).toEqual([
			{ name: "item", type: "json", required: true },
		]);
		expect(
			flows.feature?.nodes.find((node) => node.id === "traces"),
		).toMatchObject({ each: { branch: "per-item", as: "item" } });
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
		version: 6,
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
					options: [{ name: "yes" }, { name: "no" }],
					by: "model",
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

	test("a Decision node on the Claude Code decider gets the default decider", () => {
		const decision = {
			id: "decide",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Go on?",
			options: [{ name: "yes" }, { name: "no" }],
			by: "model",
		};
		const migrated = migrateFlow(
			current([
				{ ...decision, decider: "claude-code", model: "haiku" },
				{ ...decision, id: "other", decider: "ollaya", model: "laya:en" },
			]),
		) as { nodes: Record<string, unknown>[] };
		expect(migrated.nodes.map((n) => [n.decider, n.model])).toEqual([
			[undefined, undefined],
			["ollaya", "laya:en"],
		]);
		const parsed = flowSchema.parse(migrated);
		expect(parsed.nodes[0]).toMatchObject({ decider: "typesafe" });
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
	const current = (source: unknown) => ({
		version: 6,
		inputs: [{ name: "epic", type: "text", required: true }],
		outputs: [],
		start: "each",
		nodes: [
			{
				id: "each",
				type: "call",
				position: { x: 0, y: 0 },
				flow: "trace",
				inputs: {},
				each: { source, as: "item", branch: "shared", haltOn: ["halt"] },
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
		) as { nodes: { each: Record<string, unknown> }[] };
		const expected = githubSubIssuesCommand({
			parent: "{{epic}}",
			requireLabel: "Feature",
			doneLabels: ["Done", "shipped"],
			skipLabels: ["draft"],
		});
		expect(migrated.nodes[0]?.each).toEqual({
			source: { kind: "command", command: expected },
			as: "item",
			branch: "shared",
			haltOn: ["halt"],
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

describe("migrateFlow: version 2 → 3, Decision and Gate", () => {
	const v2 = () => ({
		version: 2,
		inputs: [],
		outputs: [{ name: "why", value: "{{decide.notes}} / {{ask.note}}" }],
		start: "worker",
		nodes: [
			{
				...agent,
				id: "worker",
				prompt: "Last time: {{decide.notes}} {{ask.notes}} {{notes.notes}}",
			},
			{
				id: "decide",
				type: "decision",
				position: { x: 0, y: 0 },
				label: "Go on?",
				prompt: "Go on? {{worker.summary}}",
				labels: [{ name: "go", description: "On track" }, { name: "halt" }],
				decider: "claude-code",
				model: "haiku",
				timeoutMinutes: 5,
			},
			{
				id: "ask",
				type: "gate",
				position: { x: 1, y: 1 },
				question: "Ship it? {{ decide.notes }}",
				choices: [{ name: "ship" }, { name: "wait" }],
			},
			{
				id: "run_it",
				type: "command",
				position: { x: 0, y: 0 },
				command: 'echo "{{decide.notes}}"',
			},
			{
				id: "sub",
				type: "subflow",
				position: { x: 0, y: 0 },
				flow: "other",
				inputs: { why: "{{decide.notes}}" },
			},
			{
				id: "each",
				type: "foreach",
				position: { x: 0, y: 0 },
				source: { kind: "json", value: "{{decide.notes}}" },
				flow: "other",
				as: "thing",
				inputs: { why: "{{decide.notes}}" },
				branch: "shared",
			},
		],
		edges: [
			{ id: "a", from: "worker", outcome: "pass", to: "decide" },
			{ id: "b", from: "decide", outcome: "go", to: "ask" },
			{ id: "c", from: "ask", outcome: "ship", to: "run_it" },
		],
	});

	test("a Gate becomes a Decision decided by you; a Decision one decided by a model, off the Claude Code decider", () => {
		const flow = migrateFlow(v2()) as { version: number; nodes: unknown[] };
		expect(flow.version).toBe(6);
		expect(flow.nodes[1]).toEqual({
			id: "decide",
			type: "decision",
			position: { x: 0, y: 0 },
			label: "Go on?",
			prompt: "Go on? {{worker.summary}}",
			options: [{ name: "go", description: "On track" }, { name: "halt" }],
			by: "model",
			timeoutMinutes: 5,
		});
		expect(flow.nodes[2]).toEqual({
			id: "ask",
			type: "decision",
			position: { x: 1, y: 1 },
			prompt: "Ship it? {{decide.note}}",
			options: [{ name: "ship" }, { name: "wait" }],
			by: "person",
		});
		expect(flowSchema.safeParse(flow).success).toBe(true);
	});

	test("{{<decision>.notes}} becomes {{<decision>.note}} in every template, and nowhere else", () => {
		const flow = flowSchema.parse(migrateFlow(v2()));
		const byId = Object.fromEntries(flow.nodes.map((n) => [n.id, n]));
		expect(byId.worker).toMatchObject({
			prompt: "Last time: {{decide.note}} {{ask.notes}} {{notes.notes}}",
		});
		expect(byId.run_it).toMatchObject({ command: 'echo "{{decide.note}}"' });
		expect(byId.sub).toMatchObject({ inputs: { why: "{{decide.note}}" } });
		expect(byId.each).toMatchObject({
			inputs: { why: "{{decide.note}}" },
			each: {
				source: { kind: "json", value: "{{decide.note}}" },
				as: "thing",
				branch: "shared",
			},
		});
		expect(flow.outputs).toEqual([
			{ name: "why", value: "{{decide.note}} / {{ask.note}}" },
		]);
	});

	test("a version 1 flow goes through both steps", () => {
		const flow = flowSchema.parse(migrateFlow(v1Body));
		expect(flow.version).toBe(6);
		expect(flow.nodes.find((n) => n.id === "decide")).toMatchObject({
			type: "decision",
			by: "model",
			options: [{ name: "go" }, { name: "halt" }],
		});
		expect(flow.nodes.find((n) => n.id === "ask")).toMatchObject({
			type: "decision",
			by: "person",
			prompt: "Ship {{item.url}} on {{run.branch}}?",
			options: [{ name: "ship" }],
		});
	});

	test("a current flow is left alone", () => {
		const flow = flowSchema.parse(migrateFlow(v2()));
		expect(migrateFlow(flow)).toBe(flow);
	});
});

describe("migrateFlow: version 3 → 4, Call", () => {
	const v3 = () => ({
		version: 3,
		inputs: [{ name: "epic", type: "text", required: true }],
		outputs: [{ name: "results", value: "{{each.results}}" }],
		start: "sub",
		nodes: [
			{
				id: "sub",
				label: "Review",
				type: "subflow",
				position: { x: 0, y: 0 },
				flow: "review",
				inputs: { pr: "{{epic}}" },
				timeoutMinutes: 5,
			},
			{
				id: "each",
				type: "foreach",
				position: { x: 1, y: 1 },
				source: { kind: "json", value: "{{sub.tasks}}" },
				flow: "build",
				as: "task",
				inputs: { epic: "{{epic}}" },
				branch: "shared",
				haltOn: ["stop"],
				maxItems: 3,
			},
			{
				id: "bare",
				type: "foreach",
				position: { x: 2, y: 2 },
				source: { kind: "files", glob: "*.md" },
				flow: "build",
			},
			{
				...agent,
				id: "report",
				prompt: "{{sub.ended}} {{each.summary}}",
			},
		],
		edges: [
			{ id: "a", from: "sub", outcome: "pass", to: "each" },
			{ id: "b", from: "sub", outcome: "fail", to: "report" },
			{ id: "c", from: "each", outcome: "done", to: "bare" },
			{ id: "d", from: "each", outcome: "halted", to: "report" },
			{ id: "e", from: "bare", outcome: "done", to: "report" },
		],
	});

	test("a Subflow node becomes a Call node; a For Each node a Call node with each", () => {
		const flow = migrateFlow(v3()) as { version: number; nodes: unknown[] };
		expect(flow.version).toBe(6);
		expect(flow.nodes[0]).toEqual({
			id: "sub",
			label: "Review",
			type: "call",
			position: { x: 0, y: 0 },
			flow: "review",
			inputs: { pr: "{{epic}}" },
			timeoutMinutes: 5,
		});
		expect(flow.nodes[1]).toEqual({
			id: "each",
			type: "call",
			position: { x: 1, y: 1 },
			flow: "build",
			inputs: { epic: "{{epic}}" },
			each: {
				source: { kind: "json", value: "{{sub.tasks}}" },
				as: "task",
				branch: "shared",
				haltOn: ["stop"],
				maxItems: 3,
			},
		});
		// Fields the file left out stay out, so the schema's defaults apply.
		expect(flow.nodes[2]).toEqual({
			id: "bare",
			type: "call",
			position: { x: 2, y: 2 },
			flow: "build",
			each: { source: { kind: "files", glob: "*.md" } },
		});
		expect(flow.nodes[3]).toEqual(v3().nodes[3]);
	});

	test("the migrated flow parses, keeps its edges, and validates", () => {
		const flow = flowSchema.parse(migrateFlow(v3()));
		expect(flow.edges).toEqual(v3().edges);
		expect(flow.nodes[2]).toMatchObject({
			inputs: {},
			each: { as: "item", branch: "per-item", haltOn: ["halt"] },
		});
		expect(validateFlow(flow)).toEqual([]);
	});

	test("a github source of a For Each node migrates along", () => {
		const flow = migrateFlow({
			...v3(),
			nodes: [
				{
					id: "each",
					type: "foreach",
					position: { x: 0, y: 0 },
					source: { kind: "github", parent: "{{epic}}" },
					flow: "build",
				},
			],
			edges: [],
			start: "each",
			outputs: [],
		}) as { nodes: { each: { source: { kind: string; command: string } } }[] };
		expect(flow.nodes[0]?.each.source).toEqual({
			kind: "command",
			command: githubSubIssuesCommand({ parent: "{{epic}}" }),
		});
	});

	test("a version 1 flow goes through every step", () => {
		const flow = flowSchema.parse(migrateFlow(v1Body));
		expect(flow.version).toBe(6);
		expect(flow.nodes.map((n) => n.type)).toEqual([
			"command",
			"agent",
			"decision",
			"decision",
			"call",
			"call",
		]);
	});
});
