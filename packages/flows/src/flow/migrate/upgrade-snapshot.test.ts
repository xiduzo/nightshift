import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FLOW_VERSION, flowSchema } from "../schema";
import { readBefore } from "./fixtures/frozen/oracle";
import { migrateFlow, upgradeSnapshot } from "./migrate";
import type { FlowMigration } from "./v5-to-v9";

type Json = Record<string, unknown>;

/** Each file was made from the schema of its version, with the defaults that a run wrote into its row. */
function fixtures(folder: string): { name: string; flow: Json }[] {
	const dir = join(import.meta.dir, "fixtures", folder);
	return readdirSync(dir)
		.sort()
		.map((file) => ({
			name: `${folder}/${file}`,
			flow: JSON.parse(readFileSync(join(dir, file), "utf8")) as Json,
		}));
}

const at = { position: { x: 0, y: 0 } };
const agent = {
	...at,
	id: "work",
	type: "agent",
	prompt: "Work",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "auto",
};
const flowOf = (version: unknown, nodes: unknown = [agent], more: Json = {}) =>
	({ version, start: "work", nodes, edges: [], ...more }) as Json;

/** The current format, with what the steps for any version change. */
const v9Old = {
	tools: flowOf(9, [{ ...agent, tools: ["github"] }]),
	toolsAndClis: flowOf(9, [{ ...agent, clis: ["acli"], tools: ["github"] }]),
	toolsAndGh: flowOf(9, [{ ...agent, clis: ["gh"], tools: ["github"] }]),
	noTools: flowOf(9, [{ ...agent, tools: [] }]),
	decider: flowOf(9, [
		{
			...at,
			id: "work",
			type: "decision",
			by: "model",
			prompt: "Go on?",
			options: [{ name: "go" }],
			decider: "claude-code",
			model: "haiku",
			tools: ["github"],
		},
	]),
	github: flowOf(9, [
		{
			...at,
			id: "work",
			type: "call",
			flow: "item",
			each: {
				source: {
					kind: "github",
					parent: "{{epic}}",
					requireLabel: "Ready",
					doneLabels: ["Done"],
					skipLabels: ["Skip"],
				},
			},
		},
	]),
};

const old = [
	...fixtures("v1-rpgdotexe"),
	...fixtures("snapshots"),
	...Object.entries(v9Old).map(([name, flow]) => ({
		name: `v9/${name}`,
		flow,
	})),
];

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function rewritten(value: unknown, migration?: FlowMigration): Json {
	const result = upgradeSnapshot(value, migration);
	if (result.kind !== "rewritten") throw new Error(result.kind);
	return result.flow;
}

/** The value, and every object in it, frozen: a write to it throws. */
function frozen<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const inner of Object.values(value)) frozen(inner);
		Object.freeze(value);
	}
	return value;
}

/** Every property that the rewrite of a readable old flow holds. */
function expectSameFlow(raw: Json): void {
	const text = JSON.stringify(raw);
	const flow = rewritten(frozen(raw));
	expect(JSON.stringify(raw)).toBe(text);
	// The reader of before reads the old and the new one the same, and so does the schema alone.
	expect(flowSchema.parse(flow)).toEqual(readBefore(raw) as never);
	expect(readBefore(flow)).toEqual(readBefore(raw));
	// The chain is the one of before, and nothing is left to do.
	expect(JSON.stringify(migrateFlow(flow))).toBe(JSON.stringify(flow));
	expect(upgradeSnapshot(copy(flow))).toEqual({ kind: "current" });
}

describe("an old flow", () => {
	test("the fixtures hold every version and every node type of the current format", () => {
		expect(
			[...new Set(old.map(({ flow }) => flow.version))].sort() as unknown,
		).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const types = new Set(
			old.flatMap(({ flow }) =>
				(rewritten(flow).nodes as Json[]).map((node) => node.type),
			),
		);
		// These came with format 9.
		const later = ["convert", "since-last-run", "web-request"];
		const all = flowSchema.shape.nodes.element.options.map(
			(option) => option.shape.type.value,
		);
		expect(all.filter((type) => !types.has(type)).sort() as string[]).toEqual(
			later,
		);
	});

	for (const { name, flow } of old) {
		test(`${name} reads the same after the rewrite, once and for all`, () =>
			expectSameFlow(copy(flow)));

		test(`${name} keeps fields that no version knows`, () => {
			const raw = copy(flow);
			raw.later = { deep: [1, null, "x"] };
			raw.nodes = (raw.nodes as Json[]).map((node) => ({
				...node,
				later: node.id,
			}));
			raw.edges = (raw.edges as Json[]).map((edge) => ({ ...edge, later: 1 }));
			const after = rewritten(raw);
			expect(after.later).toEqual({ deep: [1, null, "x"] });
			expect((after.nodes as Json[]).map((node) => node.later)).toEqual(
				(raw.nodes as Json[]).map((node) => node.id),
			);
			for (const edge of after.edges as Json[]) expect(edge.later).toBe(1);
			expectSameFlow(raw);
		});
	}

	test("parts of the fixtures, put together in any way, read the same", () => {
		let seed = 20261124;
		const next = (below: number) => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return Math.floor((seed / 2147483648) * below);
		};
		const some = (list: unknown) =>
			(list as unknown[]).filter(() => next(3) > 0);
		for (const { flow } of old) {
			for (let round = 0; round < 40; round++) {
				const raw = copy(flow);
				raw.nodes = some(raw.nodes);
				const edges = some(raw.edges) as Json[];
				const outcomes = ["pass", "fail", "done"];
				raw.edges = [
					...edges,
					...edges.map((edge, index) => ({
						...edge,
						id: `x${index}`,
						outcome: outcomes[next(3)],
					})),
				];
				for (const key of ["variables", "sections", "policy", "description"]) {
					if (next(2) === 0) delete raw[key];
				}
				if (upgradeSnapshot(raw).kind === "current") continue;
				expectSameFlow(raw);
			}
		}
	});

	test("the result shares nothing with the value", () => {
		const raw = copy(v9Old.tools);
		const flow = rewritten(raw);
		for (const node of flow.nodes as Json[]) {
			(node.position as Json).x = 9;
		}
		(flow.edges as unknown[]).push({});
		expect(raw).toEqual(v9Old.tools);
	});

	test("no default is written into the flow", () => {
		expect(rewritten(flowOf(8))).toEqual({ ...flowOf(9) });
		expect(Object.keys(flowSchema.parse(flowOf(9)))).toContain("inputs");
	});
});

describe("the steps for any version", () => {
	test("the schema alone drops the tools of a flow of the current format", () => {
		const alone = flowSchema.parse(v9Old.tools).nodes[0];
		expect(alone).not.toHaveProperty("clis");
		expect(rewritten(v9Old.tools).nodes).toEqual([{ ...agent, clis: ["gh"] }]);
		expect(rewritten(v9Old.toolsAndClis).nodes).toEqual([
			{ ...agent, clis: ["acli", "gh"] },
		]);
	});

	test("the schema alone does not read the old list source and the old decider", () => {
		expect(flowSchema.safeParse(v9Old.github).success).toBe(false);
		expect(flowSchema.safeParse(v9Old.decider).success).toBe(false);
	});
});

describe("the names of Devices and profiles", () => {
	const named = flowOf(6, [
		{ ...agent, profile: "night", device: " Studio " },
		{
			...at,
			id: "look",
			type: "command",
			command: "ls",
			output: "text",
			device: "Studio",
		},
	]);

	test("stay names in a snapshot, and the schema reads them", () => {
		const flow = rewritten(named);
		expect(flow.nodes).toMatchObject([
			{ profile: "night", device: { name: "Studio" } },
			{ device: { name: "Studio" } },
		]);
		expect(
			rewritten(flowOf(8, [{ ...agent, device: { name: "Studio" } }])),
		).toMatchObject({ nodes: [{ device: { name: "Studio" } }] });
	});

	test("become ids with the migration of a revision, and a later one changes nothing", () => {
		const migration = (id: string | null): FlowMigration => ({
			deviceId: "saved-on",
			deviceIdByName: (name) => (name.trim() === "Studio" ? id : null),
			profileIdByName: (device, name) => `${device}/${name}`,
		});
		const flow = rewritten(named, migration("dev-1"));
		expect(flow.nodes).toMatchObject([
			{ profile: { device: "dev-1", profile: "dev-1/night" } },
			{ device: "dev-1" },
		]);
		const unresolved = rewritten(named, migration(null));
		expect(unresolved).toEqual(rewritten(named));
		expect(upgradeSnapshot(unresolved, migration("dev-1"))).toEqual({
			kind: "current",
		});
	});
});

describe("a value that stays as it is", () => {
	test("current: no step changes it and the schema reads it", () => {
		for (const { flow } of old) {
			expect(upgradeSnapshot(rewritten(flow))).toEqual({ kind: "current" });
		}
		expect(upgradeSnapshot(flowOf(FLOW_VERSION, []))).toEqual({
			kind: "current",
		});
	});

	test("newer: not touched, also where a step for any version would change it", () => {
		for (const version of [10, 1000]) {
			const raw = flowOf(version, [{ ...agent, tools: ["github"] }]);
			expect(migrateFlow(raw)).not.toEqual(raw);
			expect(upgradeSnapshot(frozen(raw))).toEqual({ kind: "newer" });
		}
	});

	test("unreadable: a version that is not one", () => {
		for (const version of [
			undefined,
			null,
			"8",
			0,
			-1,
			1.5,
			9.5,
			Number.POSITIVE_INFINITY,
			{},
		]) {
			const raw = flowOf(version, [{ ...agent, tools: ["github"] }]);
			expect(upgradeSnapshot(frozen(raw))).toEqual({ kind: "unreadable" });
		}
	});

	test("unreadable: not a flow", () => {
		const loop: Json = flowOf(8);
		loop.self = loop;
		for (const value of [
			undefined,
			null,
			"",
			"{}",
			8,
			true,
			[],
			[flowOf(8)],
			{},
			{ version: 9 },
			{ ...flowOf(8), size: 1n },
			loop,
		]) {
			expect(upgradeSnapshot(value)).toEqual({ kind: "unreadable" });
		}
	});

	test("unreadable: too deep to walk", () => {
		let deep: unknown = 1;
		for (let depth = 0; depth < 200_000; depth++) deep = [deep];
		expect(upgradeSnapshot({ ...flowOf(8), deep })).toEqual({
			kind: "unreadable",
		});
	});

	test("unreadable: the migrated form does not parse, in an old or the current format", () => {
		for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
			for (const nodes of [[{ id: "work", type: "gone" }], [null], ["x"]]) {
				expect(upgradeSnapshot(flowOf(version, nodes))).toEqual({
					kind: "unreadable",
				});
			}
			const { start: _start, ...noStart } = flowOf(version);
			expect(upgradeSnapshot(noStart)).toEqual({ kind: "unreadable" });
		}
	});

	test("unreadable: a flow without a list of nodes, which the chain reads as empty", () => {
		for (const version of [1, 2, 3, 8, 9]) {
			for (const nodes of [null, {}, { a: agent }]) {
				expect(upgradeSnapshot(flowOf(version, nodes))).toEqual({
					kind: "unreadable",
				});
			}
		}
		const { nodes: _nodes, ...none } = flowOf(2);
		expect(flowSchema.safeParse(migrateFlow(none)).success).toBe(true);
		expect(upgradeSnapshot(none)).toEqual({ kind: "unreadable" });
	});
});

describe("what a rewrite does not keep: only the original holds it", () => {
	/** Every text in the value. */
	const texts = (value: unknown): string[] =>
		typeof value === "string"
			? [value]
			: typeof value === "object" && value !== null
				? Object.values(value).flatMap(texts)
				: [];
	const lost = (raw: Json) => {
		const kept = new Set(texts(rewritten(raw)));
		return [...new Set(texts(raw))].filter((text) => !kept.has(text)).sort();
	};
	const decision = {
		...at,
		id: "work",
		type: "decision",
		prompt: "Go on?",
		decider: "claude-code",
		model: "haiku",
	};

	test("an Agent: its checker and its own MCP servers", () => {
		for (const version of [4, 5]) {
			const raw = flowOf(version, [
				{
					...agent,
					checker: { decider: "openai", model: "small", prompt: "Done?" },
					mcpServers: {
						web: { command: "web-mcp", args: [], env: { A: "b" } },
					},
				},
			]);
			expect(lost(raw)).toEqual(
				["Done?", "b", "openai", "small", "web-mcp"].sort(),
			);
		}
	});

	test("a Decision: the model of the old decider, its tools, and the model of a person", () => {
		const options = [{ name: "go" }, { name: "halt" }];
		expect(
			lost(flowOf(1, [{ ...decision, labels: options, tools: ["github"] }])),
		).toEqual(["claude-code", "github", "haiku"]);
		expect(
			lost(
				flowOf(5, [{ ...decision, options, by: "person", decider: "openai" }]),
			),
		).toEqual(["haiku", "openai"]);
		expect(
			lost(
				flowOf(5, [{ ...decision, options, by: "model", decider: "openai" }]),
			),
		).toEqual([]);
	});

	test("an edge that version 5 never took", () => {
		const edges = ["first", "second"].map((id) => ({
			id,
			from: "work",
			outcome: "pass",
			to: "work",
		}));
		for (const version of [1, 5]) {
			expect(lost(flowOf(version, [agent], { edges }))).toEqual(["second"]);
		}
		for (const version of [6, 9]) {
			const raw = flowOf(version, [{ ...agent, tools: [] }], { edges });
			expect(lost(raw)).toEqual([]);
		}
	});

	test("a list source that the engine read: it becomes a command with its texts inside", () => {
		expect(lost(v9Old.github)).toEqual([
			"Done",
			"Ready",
			"Skip",
			"github",
			"{{epic}}",
		]);
		const nodes = rewritten(v9Old.github).nodes as Json[];
		const command = texts(nodes).join(" ");
		// The case of a label goes: labels match without it.
		for (const held of ["{{epic}}", "ready", "done", "skip"]) {
			expect(command).toContain(held);
		}
	});
});
