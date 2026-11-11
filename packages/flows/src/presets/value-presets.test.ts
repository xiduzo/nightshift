import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowNode } from "../flow";
import type { JsonValue, ValueNode } from "../nodes";
import { evaluateRule, type TemplateContext } from "../template";
import { templateScope, validateFlow } from "../validate";
import {
	itemFields,
	presetSources,
	VALUE_PRESETS,
	type ValuePresetInput,
	valuePreset,
} from "./value-presets";

/**
 * Every preset gives a Value by rule that the flow check accepts and that
 * JSONata evaluates to `{ items }` over a real list: a feed's items (typed
 * by the feed's shape) and CSV rows (all text).
 */

const at = { x: 0, y: 0 };

const NEWS: FlowNode = {
	id: "news",
	type: "convert",
	position: at,
	from: "feed",
	to: "json",
	value: "<rss/>",
};
const ROWS: FlowNode = {
	id: "sales-rows",
	type: "convert",
	position: at,
	from: "csv",
	to: "json",
	value: "a,b",
};

/** A flow where the Value `pick` runs after both lists. */
function flowWith(value: ValueNode): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "news",
		nodes: [NEWS, ROWS, value],
		edges: [
			{ id: "e1", from: "news", outcome: "pass", to: "sales-rows" },
			{ id: "e2", from: "sales-rows", outcome: "pass", to: "pick" },
		],
	};
}

const item = (
	id: string,
	title: string,
	published: string,
	tags: string[],
) => ({
	id,
	title,
	link: `https://example.com/${id}`,
	summary: "",
	content: "",
	published,
	updated: "",
	authors: [],
	categories: tags,
});

const context: TemplateContext = {
	nodes: {
		news: {
			outcome: "pass",
			data: {
				format: "rss",
				title: "News",
				link: "https://example.com",
				description: "",
				items: [
					item("a", "Rates rise", "2026-11-03T00:00:00.000Z", ["money"]),
					item("b", "New park", "2026-11-01T00:00:00.000Z", ["city"]),
					item("a", "Rates rise again", "2026-11-05T00:00:00.000Z", []),
				],
			},
		},
		"sales-rows": {
			outcome: "pass",
			data: [
				{ region: "north", amount: "120" },
				{ region: "south", amount: "80" },
				{ region: "north", amount: "15" },
			],
		},
	},
	inputs: {},
	run: {} as TemplateContext["run"],
};

/** The data of the preset's Value, checked by `validateFlow` first. */
async function run(input: ValuePresetInput): Promise<JsonValue | undefined> {
	const scope = templateScope(flowWith(valueNode("", {})));
	const source = presetSources(scope, "pick").find(
		(candidate) => candidate.ref === input.source,
	);
	expect(source).toBeDefined();
	const { expression, output } = valuePreset(input, source?.item);
	const node = valueNode(expression, output);
	const issues = validateFlow(flowWith(node)).filter(
		(issue) => issue.nodeId === "pick",
	);
	expect(issues).toEqual([]);
	return evaluateRule(expression, context);
}

function valueNode(
	expression: string,
	output: Record<string, unknown>,
): ValueNode {
	return {
		id: "pick",
		type: "value",
		position: at,
		by: "rule",
		expression,
		output,
	};
}

const ids = (data: JsonValue | undefined) =>
	(data as { items: { id: string }[] }).items.map((entry) => entry.id);
const titles = (data: JsonValue | undefined) =>
	(data as { items: { title: string }[] }).items.map((entry) => entry.title);
const amounts = (data: JsonValue | undefined) =>
	(data as { items: { amount: string }[] }).items.map((entry) => entry.amount);

describe("value presets", () => {
	test("the sources are the lists of other nodes, with their item shapes", () => {
		const sources = presetSources(
			templateScope(flowWith(valueNode("", {}))),
			"pick",
		);
		expect(sources.map((source) => source.ref)).toEqual([
			"news.data.items",
			"sales-rows.data",
		]);
		expect(itemFields(sources[0]?.item ?? {})).toContain("published");
		expect(VALUE_PRESETS.map((preset) => preset.name)).toEqual([
			"filter",
			"pick",
			"sort",
			"limit",
			"unique",
		]);
	});

	test("Filter compares as the field's shape says", async () => {
		const filter = (
			source: string,
			field: string,
			compare: "equals" | "differs" | "contains" | "above" | "below" | "exists",
			value = "",
		) => run({ preset: "filter", source, field, compare, value });
		expect(ids(await filter("news.data.items", "id", "equals", "a"))).toEqual([
			"a",
			"a",
		]);
		expect(ids(await filter("news.data.items", "id", "differs", "a"))).toEqual([
			"b",
		]);
		expect(
			titles(await filter("news.data.items", "title", "contains", "Rates")),
		).toEqual(["Rates rise", "Rates rise again"]);
		expect(
			ids(await filter("news.data.items", "categories", "contains", "city")),
		).toEqual(["b"]);
		expect(
			ids(await filter("news.data.items", "published", "above", "2026-11-02")),
		).toEqual(["a", "a"]);
		// CSV gives text: a number still compares as a number.
		expect(
			amounts(await filter("sales-rows.data", "amount", "above", "100")),
		).toEqual(["120"]);
		expect(
			amounts(await filter("sales-rows.data", "amount", "below", "100")),
		).toEqual(["80", "15"]);
		expect(
			amounts(await filter("sales-rows.data", "region", "exists")),
		).toEqual(["120", "80", "15"]);
	});

	test("Pick fields keeps those fields, typed by the item shape", async () => {
		const input: ValuePresetInput = {
			preset: "pick",
			source: "news.data.items",
			fields: ["title", "link"],
		};
		const data = await run(input);
		expect((data as { items: unknown[] }).items[1]).toEqual({
			title: "New park",
			link: "https://example.com/b",
		});
		const sources = presetSources(
			templateScope(flowWith(valueNode("", {}))),
			"pick",
		);
		expect(valuePreset(input, sources[0]?.item).output).toEqual({
			type: "object",
			properties: {
				items: {
					type: "array",
					items: {
						type: "object",
						properties: { title: { type: "string" }, link: { type: "string" } },
					},
				},
			},
			required: ["items"],
		});
	});

	test("Sort, Limit and Remove duplicates keep a list, also of one item", async () => {
		expect(
			titles(
				await run({
					preset: "sort",
					source: "news.data.items",
					field: "published",
					order: "descending",
				}),
			),
		).toEqual(["Rates rise again", "Rates rise", "New park"]);
		expect(
			ids(await run({ preset: "limit", source: "news.data.items", count: 1 })),
		).toEqual(["a"]);
		expect(
			ids(
				await run({ preset: "unique", source: "news.data.items", field: "id" }),
			),
		).toEqual(["a", "b"]);
		expect(
			amounts(
				await run({ preset: "unique", source: "sales-rows.data", field: "" }),
			),
		).toEqual(["120", "80", "15"]);
	});

	test("a name JSONata cannot take bare goes in backticks", () => {
		const { expression } = valuePreset({
			preset: "filter",
			source: "sales-rows.data",
			field: "first name",
			compare: "equals",
			value: "Ann",
		});
		expect(expression).toBe(
			'{"items": [$filter(`sales-rows`.data, function($v) { $v.`first name` = "Ann" })]}',
		);
		expect(
			valuePreset({
				preset: "sort",
				source: "a.data",
				field: "in",
				order: "ascending",
			}).expression,
		).toBe(
			'{"items": [$sort(a.data, function($a, $b) { $a.`in` > $b.`in` })]}',
		);
	});
});
