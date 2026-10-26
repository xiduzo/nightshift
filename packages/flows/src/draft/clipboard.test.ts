import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema } from "../document";
import { copyNodes, pasteNodes } from "./clipboard";

const command = (id: string, command = "true") => ({
	id,
	type: "command" as const,
	position: { x: 0, y: 0 },
	command,
});

/** a → b → c, with b reading a and c in a Section of its own. */
const chain: Flow = flowSchema.parse({
	version: 5,
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
