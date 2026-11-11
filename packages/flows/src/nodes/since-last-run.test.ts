import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	NODE_FAMILY,
	nodeOutcomes,
	outputFieldsByType,
} from "../flow";
import { outputFieldShape } from "../shapes";
import { type FlowIssue, validateFlow } from "../validate";
import type { CommandNode } from "./command";
import { memoryPath, type SinceLastRunNode } from "./since-last-run";

/** The Since last run node: what is new or changed since the last run. */

function seen(extra: Partial<SinceLastRunNode> = {}): SinceLastRunNode {
	return {
		id: "fresh",
		type: "since-last-run",
		position: { x: 0, y: 0 },
		items: "{{feed.data.items}}",
		key: "link",
		...extra,
	};
}

function command(id: string, extra: Partial<CommandNode> = {}): CommandNode {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: "true",
		stdout: "json",
		...extra,
	};
}

/** feed → fresh, with an input `limit`. */
function flowOf(node: SinceLastRunNode, more: Flow["nodes"] = []): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [{ name: "limit", type: "number" }],
		outputs: [],
		start: "feed",
		nodes: [command("feed"), node, ...more],
		edges: [{ id: "a", from: "feed", outcome: "pass", to: "fresh" }],
	};
}

const messages = (issues: FlowIssue[], severity: FlowIssue["severity"]) =>
	issues
		.filter((issue) => issue.severity === severity)
		.map((issue) => issue.message);

describe("the Since last run node", () => {
	test("given a list with a key, then the flow has no issues", () => {
		expect(validateFlow(flowOf(seen()))).toEqual([]);
	});

	test("given a value with a rule over previous, current and an input, then the flow has no issues", () => {
		const node = seen({
			items: undefined,
			key: undefined,
			value: "{{feed.data.price}}",
			when: "current > limit and previous <= limit",
			scope: "{{feed.data.market}}",
			firstRun: "same",
		});
		expect(validateFlow(flowOf(node))).toEqual([]);
	});

	test("given no list and no value, or both, then it is an error on the node", () => {
		expect(
			messages(validateFlow(flowOf(seen({ items: "" }))), "error"),
		).toEqual([
			'Since last run node "fresh" needs a list or a value to watch. Give it one of the two.',
		]);
		expect(
			messages(
				validateFlow(flowOf(seen({ key: undefined, value: "{{feed.data}}" }))),
				"error",
			),
		).toEqual([
			'Since last run node "fresh" has a list and a value. Keep one of the two.',
		]);
	});

	test("given a value with a key, or a list with a rule, then it is an error on the node", () => {
		expect(
			messages(
				validateFlow(
					flowOf(seen({ items: undefined, value: "{{feed.data.price}}" })),
				),
				"error",
			),
		).toEqual([
			'Since last run node "fresh" watches a value, so it reads no key and no fields to compare. Remove them, or watch a list.',
		]);
		expect(
			messages(validateFlow(flowOf(seen({ when: "current > 1" }))), "error"),
		).toEqual([
			'Since last run node "fresh" watches a list, so it reads no rule. Remove the rule, or watch a value.',
		]);
	});

	test("given a path with an empty part, then it is an error on the node", () => {
		expect(
			messages(
				validateFlow(flowOf(seen({ compare: ["title", "user..id"] }))),
				"error",
			),
		).toEqual([
			'Since last run node "fresh" has the path "user..id", which is not valid. Name the fields with dots between them: user.id.',
		]);
		expect(memoryPath("user.id")).toEqual(["user", "id"]);
		expect(memoryPath(".id")).toEqual([]);
	});

	test("given a rule or a template that reads an unknown name, then it is an error on the node", () => {
		const rule = validateFlow(
			flowOf(
				seen({
					items: undefined,
					key: undefined,
					value: "{{feed.data.price}}",
					when: "current > ceiling",
				}),
			),
		);
		expect(messages(rule, "error")).toEqual([
			'The rule of "fresh" reads "ceiling", but there is no node or input "ceiling".',
		]);
		const scope = validateFlow(flowOf(seen({ scope: "{{ghost.name}}" })));
		expect(messages(scope, "error")).toEqual([
			expect.stringContaining("{{ghost.name}}"),
		]);
	});

	test("its outcomes are new, changed and same, and it is a Shape node", () => {
		expect(nodeOutcomes(seen())).toEqual(["new", "changed", "same"]);
		expect(outputFieldsByType["since-last-run"]).toEqual([
			"outcome",
			"data",
			"visit",
		]);
		expect(NODE_FAMILY["since-last-run"]).toBe("shape");
	});

	test("its data has the new and changed items, and a value adds previous and current", () => {
		const list = outputFieldShape(seen(), "data") as {
			properties: Record<string, unknown>;
		};
		expect(Object.keys(list.properties)).toEqual([
			"new",
			"changed",
			"same_count",
			"first_run",
		]);
		const value = outputFieldShape(
			seen({ items: undefined, key: undefined, value: "{{feed.data}}" }),
			"data",
		) as { properties: Record<string, unknown> };
		expect(Object.keys(value.properties)).toContain("previous");
	});

	test("given a later node that reads a field its data lacks, then it warns", () => {
		const issues = validateFlow({
			...flowOf(seen(), [
				command("report", { command: 'echo "{{fresh.data.fresh_items}}"' }),
			]),
			edges: [
				{ id: "a", from: "feed", outcome: "pass", to: "fresh" },
				{ id: "b", from: "fresh", outcome: "new", to: "report" },
			],
		});
		expect(messages(issues, "warning")).toEqual([
			expect.stringContaining('has no field "fresh_items"'),
		]);
	});

	test("the schema keeps the fields a flow file sets and refuses an unknown first run", () => {
		const parsed = flowSchema.parse(flowOf(seen({ firstRun: "same" })));
		expect(parsed.nodes[1]).toEqual(seen({ firstRun: "same" }));
		expect(() =>
			flowSchema.parse(flowOf(seen({ firstRun: "old" as never }))),
		).toThrow();
	});
});
