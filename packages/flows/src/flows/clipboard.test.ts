import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { copyNodes, pasteNodes } from "./clipboard";

const command = (id: string, command = "true") => ({
	id,
	type: "command" as const,
	position: { x: 0, y: 0 },
	command,
});

/** a → b → c, with b reading a and c in a Section of its own. */
const chain: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "a",
	nodes: [command("a"), command("b", "echo {{ a.stdout }}"), command("c")],
	edges: [
		{ id: "ab", from: "a", outcome: "pass", to: "b" },
		{ id: "bc", from: "b", outcome: "pass", to: "c", max: 2 },
	],
	sections: [{ id: "end", label: "End", color: "violet", nodes: ["c"] }],
});

describe("copyNodes", () => {
	test("keeps the edges between the nodes and the Sections they fill", () => {
		expect(copyNodes(chain, ["b", "c"])).toEqual({
			nodes: [chain.nodes[1], chain.nodes[2]] as Flow["nodes"],
			edges: [{ id: "bc", from: "b", outcome: "pass", to: "c", max: 2 }],
			sections: [{ id: "end", label: "End", color: "violet", nodes: ["c"] }],
		});
	});

	test("is null without nodes of the flow", () => {
		expect(copyNodes(chain, ["x"])).toBeNull();
	});
});

describe("pasteNodes", () => {
	test("gives taken names a free one and moves the nodes by the offset", () => {
		const clip = copyNodes(chain, ["a", "b"]);
		if (!clip) throw new Error("expected a clip");
		const { flow, ids } = pasteNodes(chain, clip, { x: 40, y: 10.4 });
		expect(ids).toEqual(["a_2", "b_2"]);
		expect(flow.start).toBe("a");
		expect(flow.nodes.at(-1)).toMatchObject({
			id: "b_2",
			command: "echo {{ a_2.stdout }}",
			position: { x: 40, y: 10 },
		});
		expect(flow.edges.at(-1)).toEqual({
			id: "a_2-pass-b_2",
			from: "a_2",
			outcome: "pass",
			to: "b_2",
		});
	});

	test("the pasted nodes read each other under their new names in their rules", () => {
		const decide = {
			id: "go",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "",
			by: "rule",
			options: [
				{ name: "yes", when: 'a.exit_code = 0 and b.stdout = "a"' },
				{ name: "no" },
			],
			set: [{ variable: "n", expression: "go.outcome = 'yes' and a.stdout" }],
		};
		const flow: Flow = flowSchema.parse({
			...chain,
			nodes: [...chain.nodes, decide],
		});
		const clip = copyNodes(flow, ["a", "go"]);
		if (!clip) throw new Error("expected a clip");
		expect(pasteNodes(flow, clip).flow.nodes.at(-1)).toMatchObject({
			id: "go_2",
			options: [
				{ name: "yes", when: 'a_2.exit_code = 0 and b.stdout = "a"' },
				{ name: "no" },
			],
			set: [
				{ variable: "n", expression: "go_2.outcome = 'yes' and a_2.stdout" },
			],
		});
	});

	test("a pasted node named as a rule's own value gets a free name, and its readers follow", () => {
		const clip = {
			nodes: flowSchema.parse({
				version: FLOW_VERSION,
				start: "current",
				nodes: [
					command("current"),
					{
						id: "moved",
						type: "since-last-run",
						position: { x: 0, y: 0 },
						value: "{{current.stdout}}",
						when: "current != previous and current.stdout != ''",
					},
				],
				edges: [],
			}).nodes,
			edges: [],
			sections: [],
		};
		const empty: Flow = { ...chain, nodes: [], edges: [], sections: [] };
		const { flow, ids } = pasteNodes(empty, clip);
		expect(ids).toEqual(["current_2", "moved"]);
		// The rule's own `current` stays: it is the value, not the node.
		expect(flow.nodes.at(-1)).toMatchObject({
			value: "{{current_2.stdout}}",
			when: "current != previous and current.stdout != ''",
		});
	});

	test("a pasted node named cascade gets a free name, and its readers follow", () => {
		const clip = {
			nodes: flowSchema.parse({
				version: FLOW_VERSION,
				start: "cascade",
				nodes: [
					command("cascade"),
					command("after", "echo {{cascade.stdout}}"),
				],
				edges: [],
			}).nodes,
			edges: [],
			sections: [],
		};
		const empty: Flow = { ...chain, nodes: [], edges: [], sections: [] };
		const { flow, ids } = pasteNodes(empty, clip);
		expect(ids).toEqual(["cascade_2", "after"]);
		expect(flow.nodes.at(-1)).toMatchObject({
			command: "echo {{cascade_2.stdout}}",
		});
	});

	test("keeps references to nodes that were not pasted", () => {
		const clip = copyNodes(chain, ["b"]);
		if (!clip) throw new Error("expected a clip");
		const { flow } = pasteNodes(chain, clip);
		expect(flow.nodes.at(-1)).toMatchObject({ command: "echo {{ a.stdout }}" });
		expect(flow.edges).toEqual(chain.edges);
	});

	test("makes the Sections anew, and the first node starts an empty flow", () => {
		const clip = copyNodes(chain, ["c"]);
		if (!clip) throw new Error("expected a clip");
		const { sections: _, ...rest } = chain;
		const empty: Flow = { ...rest, start: "", nodes: [], edges: [] };
		const { flow, ids } = pasteNodes(empty, clip);
		expect(ids).toEqual(["c"]);
		expect(flow.start).toBe("c");
		expect(flow.sections).toEqual([
			{ id: "end", label: "End", color: "violet", nodes: ["c"] },
		]);
		const again = pasteNodes(flow, clip);
		expect(again.flow.sections?.at(-1)).toEqual({
			id: "end-2",
			label: "End",
			color: "violet",
			nodes: ["c_2"],
		});
	});
});

describe("Sections inside Sections", () => {
	const nested: Flow = {
		...chain,
		sections: [
			{ id: "end", label: "End", nodes: ["c"] },
			{ id: "tail", label: "Tail", nodes: ["b"], sections: ["end"] },
		],
	};

	test("copies a Section with the Sections inside it", () => {
		expect(copyNodes(nested, ["b", "c"])?.sections).toEqual([
			{ id: "end", label: "End", nodes: ["c"] },
			{ id: "tail", label: "Tail", nodes: ["b"], sections: ["end"] },
		]);
		// Only the inner one is whole.
		expect(copyNodes(nested, ["c"])?.sections).toEqual([
			{ id: "end", label: "End", nodes: ["c"] },
		]);
	});

	test("pastes them holding each other under their new ids", () => {
		const clip = copyNodes(nested, ["b", "c"]);
		if (!clip) throw new Error("no clip");
		const pasted = pasteNodes(nested, clip).flow.sections?.slice(2);
		expect(pasted).toEqual([
			{ id: "end-2", label: "End", nodes: ["c_2"] },
			{ id: "tail-2", label: "Tail", nodes: ["b_2"], sections: ["end-2"] },
		]);
	});
});
