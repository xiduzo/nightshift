import { describe, expect, test } from "bun:test";
import {
	applyNodeSelection,
	type Selection,
	selectedNodeIds,
	withoutNodes,
} from "./selection";

const on = (id: string) => ({ id, selected: true });
const off = (id: string) => ({ id, selected: false });

describe("applyNodeSelection", () => {
	test("one node, then a second one added", () => {
		const one = applyNodeSelection(null, [on("a")]);
		expect(one).toEqual({ kind: "node", id: "a" });
		expect(applyNodeSelection(one, [on("b")])).toEqual({
			kind: "nodes",
			ids: ["a", "b"],
		});
	});

	test("a click on another node: React Flow unselects the first", () => {
		expect(
			applyNodeSelection({ kind: "node", id: "a" }, [on("b"), off("a")]),
		).toEqual({ kind: "node", id: "b" });
	});

	test("a Section's frame selects the Section", () => {
		expect(applyNodeSelection(null, [on("section:review")])).toEqual({
			kind: "section",
			id: "review",
		});
		expect(
			applyNodeSelection({ kind: "section", id: "review" }, [
				off("section:review"),
			]),
		).toBeNull();
	});

	test("nodes win over a frame in the same box", () => {
		expect(
			applyNodeSelection(null, [on("section:review"), on("ux"), on("code")]),
		).toEqual({ kind: "nodes", ids: ["ux", "code"] });
	});

	test("unselecting every node leaves nothing, an edge stays", () => {
		expect(applyNodeSelection({ kind: "node", id: "a" }, [off("a")])).toBe(
			null,
		);
		const edge: Selection = { kind: "edge", id: "e" };
		expect(applyNodeSelection(edge, [off("a")])).toBe(edge);
		expect(applyNodeSelection(edge, [])).toBe(edge);
	});
});

describe("selection helpers", () => {
	test("the selected nodes", () => {
		expect(selectedNodeIds({ kind: "node", id: "a" })).toEqual(["a"]);
		expect(selectedNodeIds({ kind: "nodes", ids: ["a", "b"] })).toEqual([
			"a",
			"b",
		]);
		expect(selectedNodeIds({ kind: "section", id: "s" })).toEqual([]);
		expect(selectedNodeIds(null)).toEqual([]);
	});

	test("drops nodes that are gone or folded away", () => {
		const gone = new Set(["b", "c"]);
		expect(withoutNodes({ kind: "nodes", ids: ["a", "b", "c"] }, gone)).toEqual(
			{ kind: "node", id: "a" },
		);
		expect(withoutNodes({ kind: "nodes", ids: ["b", "c"] }, gone)).toBeNull();
		expect(withoutNodes({ kind: "node", id: "b" }, gone)).toBeNull();
		const kept: Selection = { kind: "nodes", ids: ["a", "d"] };
		expect(withoutNodes(kept, gone)).toBe(kept);
	});
});
