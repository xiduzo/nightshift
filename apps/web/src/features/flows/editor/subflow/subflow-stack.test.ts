import { describe, expect, test } from "bun:test";

import {
	enterSubflow,
	isSubflowCycle,
	leaveSubflow,
	leaveSubflowTo,
	type SubflowStack,
	subflowContent,
	subflowCrumbs,
	subflowKey,
} from "./subflow-stack";

const view = { x: 10, y: -20, zoom: 0.8 };

describe("enterSubflow", () => {
	test("pushes a level from the root without a viewport", () => {
		expect(enterSubflow([], { nodeId: "review", flow: "review-loop" })).toEqual(
			[{ nodeId: "review", flow: "review-loop" }],
		);
	});

	test("keeps the viewport of the level you leave", () => {
		const stack = enterSubflow(
			[{ nodeId: "review", flow: "review-loop" }],
			{ nodeId: "fix", flow: "fix-step" },
			view,
		);
		expect(stack).toEqual([
			{ nodeId: "review", flow: "review-loop", viewport: view },
			{ nodeId: "fix", flow: "fix-step" },
		]);
	});

	test("does not change the stack it gets", () => {
		const stack: SubflowStack = [{ nodeId: "review", flow: "review-loop" }];
		enterSubflow(stack, { nodeId: "fix", flow: "fix-step" }, view);
		expect(stack).toEqual([{ nodeId: "review", flow: "review-loop" }]);
	});
});

describe("leaving", () => {
	const stack: SubflowStack = [
		{ nodeId: "a", flow: "one", viewport: view },
		{ nodeId: "b", flow: "two", viewport: view },
		{ nodeId: "c", flow: "three" },
	];

	test("one level up drops the deepest level", () => {
		expect(leaveSubflow(stack)).toEqual(stack.slice(0, 2));
	});

	test("up at the root stays at the root", () => {
		expect(leaveSubflow([])).toEqual([]);
	});

	test("to a depth keeps that many levels, with their viewports", () => {
		expect(leaveSubflowTo(stack, 1)).toEqual([
			{ nodeId: "a", flow: "one", viewport: view },
		]);
		expect(leaveSubflowTo(stack, 0)).toEqual([]);
	});

	test("to the current depth or deeper keeps the stack", () => {
		expect(leaveSubflowTo(stack, 3)).toBe(stack);
		expect(leaveSubflowTo(stack, 9)).toBe(stack);
	});
});

describe("isSubflowCycle", () => {
	test("no levels is no cycle", () => {
		expect(isSubflowCycle("root", [])).toBe(false);
	});

	test("a flow that runs the root flow", () => {
		expect(isSubflowCycle("root", [{ nodeId: "a", flow: "root" }])).toBe(true);
	});

	test("a flow already open between the root and here", () => {
		expect(
			isSubflowCycle("root", [
				{ nodeId: "a", flow: "one" },
				{ nodeId: "b", flow: "two" },
				{ nodeId: "c", flow: "one" },
			]),
		).toBe(true);
	});

	test("the same flow on two levels apart from the deepest is not checked again", () => {
		// Only the deepest level counts: the levels above it were fine when you opened them.
		expect(
			isSubflowCycle("root", [
				{ nodeId: "a", flow: "one" },
				{ nodeId: "b", flow: "two" },
			]),
		).toBe(false);
	});
});

describe("subflowCrumbs", () => {
	test("the root first, then one crumb per level", () => {
		expect(
			subflowCrumbs("feature-factory", [
				{ nodeId: "review", flow: "review-loop", viewport: view },
				{ nodeId: "fix", flow: "fix-step" },
			]),
		).toEqual([
			{ depth: 0, flow: "feature-factory", nodeId: null },
			{ depth: 1, flow: "review-loop", nodeId: "review" },
			{ depth: 2, flow: "fix-step", nodeId: "fix" },
		]);
	});
});

describe("subflowContent", () => {
	const flows = { "review-loop": { id: "review" }, broken: null };

	test("nothing at the root", () => {
		expect(subflowContent("root", [], flows)).toBeNull();
	});

	test("the flow of the deepest level", () => {
		expect(
			subflowContent("root", [{ nodeId: "a", flow: "review-loop" }], flows),
		).toEqual({ kind: "flow", flow: { id: "review" } });
	});

	test("loading while the flow files load", () => {
		expect(
			subflowContent("root", [{ nodeId: "a", flow: "review-loop" }], undefined),
		).toEqual({ kind: "loading" });
	});

	test("missing when the project has no such flow", () => {
		expect(
			subflowContent("root", [{ nodeId: "a", flow: "gone" }], flows),
		).toEqual({ kind: "missing" });
	});

	test("not valid when its file is not valid", () => {
		expect(
			subflowContent("root", [{ nodeId: "a", flow: "broken" }], flows),
		).toEqual({ kind: "invalid" });
	});

	test("a cycle wins, also before the files load", () => {
		expect(
			subflowContent("root", [{ nodeId: "a", flow: "root" }], undefined),
		).toEqual({ kind: "cycle" });
	});
});

describe("subflowKey", () => {
	const press = {
		key: "i",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		defaultPrevented: false,
		inField: false,
	};

	test("i goes in, u and Escape go up", () => {
		expect(subflowKey(press)).toBe("in");
		expect(subflowKey({ ...press, key: "I" })).toBe("in");
		expect(subflowKey({ ...press, key: "u" })).toBe("up");
		expect(subflowKey({ ...press, key: "Escape" })).toBe("up");
		expect(subflowKey({ ...press, key: "x" })).toBeNull();
	});

	test("ignored while you type, with a modifier, or when handled", () => {
		expect(subflowKey({ ...press, inField: true })).toBeNull();
		expect(subflowKey({ ...press, metaKey: true })).toBeNull();
		expect(subflowKey({ ...press, ctrlKey: true })).toBeNull();
		expect(subflowKey({ ...press, altKey: true })).toBeNull();
		expect(subflowKey({ ...press, defaultPrevented: true })).toBeNull();
	});
});
