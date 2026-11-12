import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	type FlowNode,
	NODE_FAMILY,
	nodeOutputFields,
} from "../flow";
import type {
	ConvertNode,
	DecisionNode,
	SinceLastRunNode,
	ValueNode,
} from "../nodes";
import { NODE_FAMILIES, NODE_FAMILY_LABEL } from "../nodes";
import { mainOutputField } from "../shapes";
import {
	addCalledNode,
	addEdge,
	addNode,
	addNodeAfter,
	moveNodes,
	NEW_NODE_TAKES,
	type NewNodeKind,
} from "./graph";
import { commandNode } from "./nodes";

const at = { x: 0, y: 0 };
const later = { x: 300, y: 0 };

function flowOf(...nodes: FlowNode[]): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges: [],
	};
}

const fetch: FlowNode = {
	id: "fetch",
	type: "web-request",
	position: at,
	method: "GET",
	url: "https://example.com/prices.csv",
};

const feed: FlowNode = {
	id: "read-feed",
	type: "convert",
	position: at,
	from: "feed",
	to: "json",
	value: "{{fetch.body}}",
};

function added<T extends FlowNode>(
	result: { flow: Flow; id: string },
	type: T["type"],
): T {
	const node = result.flow.nodes.find(
		(candidate) => candidate.id === result.id,
	);
	expect(node?.type).toBe(type);
	return node as T;
}

describe("NEW_NODE_TAKES", () => {
	test("a Branch, a Value, Since last run and Convert take a value", () => {
		const takes = Object.entries(NEW_NODE_TAKES)
			.filter(([, what]) => what === "value")
			.map(([kind]) => kind)
			.sort();
		expect(takes).toEqual(["branch", "convert", "since-last-run", "value"]);
	});

	test("every kind a person can add is in it once", () => {
		const kinds: NewNodeKind[] = [
			...(Object.keys(NODE_FAMILY) as NewNodeKind[]),
			"gate",
			"branch",
		];
		expect(Object.keys(NEW_NODE_TAKES).sort()).toEqual([...kinds].sort());
	});
});

describe("mainOutputField", () => {
	test("each new node's main field is one of its output fields", () => {
		for (const kind of Object.keys(NEW_NODE_TAKES) as NewNodeKind[]) {
			const { flow, id } = addNode(flowOf(), kind, at);
			const node = flow.nodes.find((candidate) => candidate.id === id);
			if (!node) throw new Error(`no ${kind} node`);
			expect(nodeOutputFields(node), kind).toContain(mainOutputField(node));
		}
	});
});

describe("NODE_FAMILY_LABEL", () => {
	test("every family has a label, in the order of the families", () => {
		expect(Object.keys(NODE_FAMILY_LABEL)).toEqual([...NODE_FAMILIES]);
		expect(Object.values(NODE_FAMILY_LABEL)).toEqual([
			"Do",
			"Decide",
			"Shape",
			"Hold",
			"Compose",
		]);
	});
});

describe("addNodeAfter", () => {
	test("a Convert converts the main output and follows the first outcome", () => {
		const result = addNodeAfter(flowOf(fetch), "convert", "fetch", later);
		const node = added<ConvertNode>(result, "convert");
		expect(node.value).toBe("{{fetch.body}}");
		expect(node.position).toEqual(later);
		expect(result.flow.edges).toEqual([
			{
				id: "fetch-pass-convert",
				from: "fetch",
				outcome: "pass",
				to: "convert",
			},
		]);
	});

	test("Since last run compares the one list in the main output", () => {
		const result = addNodeAfter(
			flowOf(fetch, feed),
			"since-last-run",
			"read-feed",
			later,
		);
		const node = added<SinceLastRunNode>(result, "since-last-run");
		expect(node.items).toBe("{{read-feed.data.items}}");
	});

	test("Since last run takes the whole field when it holds no single list", () => {
		const result = addNodeAfter(
			flowOf(fetch),
			"since-last-run",
			"fetch",
			later,
		);
		expect(added<SinceLastRunNode>(result, "since-last-run").items).toBe(
			"{{fetch.body}}",
		);
	});

	test("a Value and a Branch read it in their rule, in JSONata", () => {
		const value = added<ValueNode>(
			addNodeAfter(flowOf(feed), "value", "read-feed", later),
			"value",
		);
		expect(value.expression).toBe("`read-feed`.data");
		const branch = added<DecisionNode>(
			addNodeAfter(flowOf(fetch), "branch", "fetch", later),
			"decision",
		);
		expect(branch.by).toBe("rule");
		expect(branch.options).toEqual([
			{ name: "yes", when: "fetch.body" },
			{ name: "no" },
		]);
	});

	test("the edge comes only when no edge leaves on that outcome yet", () => {
		const first = addNodeAfter(flowOf(fetch), "convert", "fetch", later);
		const second = addNodeAfter(first.flow, "convert", "fetch", later);
		expect(second.id).toBe("convert_2");
		expect(second.flow.edges.map((edge) => edge.to)).toEqual(["convert"]);
		// Another outcome is free: the edge still waits for the first one.
		const busy = addEdge(flowOf(fetch, feed), "fetch", "pass", "read-feed");
		const third = addNodeAfter(busy?.flow ?? flowOf(), "value", "fetch", later);
		expect(third.flow.edges).toHaveLength(1);
	});

	test("ids stay unique", () => {
		let flow = flowOf(fetch);
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			const result = addNodeAfter(flow, "value", "fetch", later);
			flow = result.flow;
			ids.push(result.id);
		}
		expect(ids).toEqual(["value", "value_2", "value_3"]);
		expect(new Set(flow.nodes.map((node) => node.id)).size).toBe(4);
	});

	test("a node that starts from nothing gets only the edge", () => {
		const result = addNodeAfter(flowOf(fetch), "agent", "fetch", later);
		expect(added<FlowNode>(result, "agent")).toMatchObject({ prompt: "" });
		expect(result.flow.edges).toHaveLength(1);
	});

	test("after an End there is no edge", () => {
		const end: FlowNode = {
			id: "end",
			type: "end",
			position: at,
			status: "done",
		};
		const result = addNodeAfter(flowOf(end), "convert", "end", later);
		expect(added<ConvertNode>(result, "convert").value).toBe("{{end.message}}");
		expect(result.flow.edges).toEqual([]);
	});

	test("without that node it adds the node as it is", () => {
		const result = addNodeAfter(flowOf(fetch), "convert", "gone", later);
		expect(added<ConvertNode>(result, "convert").value).toBe("");
		expect(result.flow.edges).toEqual([]);
	});
});

describe("addCalledNode", () => {
	test("runs the flow, with an id from its name", () => {
		const result = addCalledNode(
			flowOf(fetch),
			"kit:github/publish-draft-pr",
			later,
		);
		expect(result.id).toBe("publish_draft_pr");
		expect(added<FlowNode>(result, "call")).toEqual({
			id: "publish_draft_pr",
			type: "call",
			position: later,
			flow: "kit:github/publish-draft-pr",
			inputs: {},
		});
		expect(result.flow.start).toBe("fetch");
		expect(result.flow.edges).toEqual([]);
	});

	test("a flow of the project, a name that starts with a digit, the first node", () => {
		expect(addCalledNode(flowOf(), "weekly-report", at)).toMatchObject({
			id: "weekly_report",
			flow: { start: "weekly_report" },
		});
		expect(addCalledNode(flowOf(), "2fa-check", at).id).toBe("flow_2fa_check");
	});

	test("an id is never a name a rule reads as its own", () => {
		expect(addCalledNode(flowOf(), "kit:prices/current", at).id).toBe(
			"current_2",
		);
		expect(addCalledNode(flowOf(), "previous", at).id).toBe("previous_2");
	});

	test("an id is never the name a node with a cascade reads as its own", () => {
		expect(addCalledNode(flowOf(), "kit:tiers/cascade", at).id).toBe(
			"cascade_2",
		);
	});

	test("ids stay unique and short enough", () => {
		let flow = flowOf(fetch);
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			const result = addCalledNode(flow, "kit:feeds/read", later);
			flow = result.flow;
			ids.push(result.id);
		}
		expect(ids).toEqual(["read", "read_2", "read_3"]);

		const long = `${"a".repeat(30)}-${"b".repeat(29)}`;
		const first = addCalledNode(flowOf(), long, at);
		const second = addCalledNode(first.flow, long, at);
		expect(first.id).toHaveLength(40);
		expect(second.id).toHaveLength(40);
		expect(second.id.endsWith("_2")).toBe(true);
	});

	test("an input or a reserved name is taken too", () => {
		const flow: Flow = {
			...flowOf(),
			inputs: [{ name: "read", type: "text" }],
		};
		expect(addCalledNode(flow, "kit:feeds/read", at).id).toBe("read_2");
		expect(addCalledNode(flowOf(), "vars", at).id).toBe("vars_2");
	});
});

describe("moveNodes", () => {
	test("moves every listed node in one copy and leaves the others", () => {
		const flow = flowOf(
			commandNode("a", { x: 0, y: 0 }),
			commandNode("b", { x: 10, y: 10 }),
		);
		const moved = moveNodes(
			flow,
			new Map([
				["a", { x: 1.4, y: 2.6 }],
				["missing", { x: 9, y: 9 }],
			]),
		);
		expect(moved.nodes[0]?.position).toEqual({ x: 1, y: 3 });
		expect(moved.nodes[1]).toBe(flow.nodes[1]);
		expect(moveNodes(flow, new Map())).toBe(flow);
	});
});
