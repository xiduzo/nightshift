import { describe, expect, test } from "bun:test";
import type { Scope } from "./events";
import { holdCovers, type LeaseHold, leavingHolds } from "./holds";

const body: Scope = { parentStepId: "call-step", itemId: null };

const hold = (extra: Partial<LeaseHold> = {}): LeaseHold => ({
	kind: "lease",
	name: "stack",
	nodeId: "own",
	scope: null,
	section: { id: "deploy", nodes: ["own", "up", "test"] },
	ttlMinutes: 30,
	at: 1,
	...extra,
});

describe("leavingHolds", () => {
	test("given an edge from inside the Section to outside, then its hold leaves", () => {
		const held = hold();
		expect(
			leavingHolds([held], {
				stepId: "s1",
				scope: null,
				edges: [{ from: "test", to: "report" }],
			}),
		).toEqual([held]);
	});

	test("given an edge inside the Section, or into it, then nothing leaves", () => {
		expect(
			leavingHolds([hold()], {
				stepId: "s1",
				scope: null,
				edges: [
					{ from: "up", to: "test" },
					{ from: "plan", to: "own" },
				],
			}),
		).toEqual([]);
	});

	test("given a lease of the whole run, then no edge lets go of it", () => {
		expect(
			leavingHolds([hold({ section: null })], {
				stepId: "s1",
				scope: null,
				edges: [{ from: "test", to: "report" }],
			}),
		).toEqual([]);
	});

	test("given an edge of another flow's scope with the same node ids, then nothing leaves", () => {
		expect(
			leavingHolds([hold({ scope: body })], {
				stepId: "s1",
				scope: null,
				edges: [{ from: "test", to: "report" }],
			}),
		).toEqual([]);
	});

	test("given the end of the Call step whose flow took it, then a Section's hold leaves and the run's stays", () => {
		const section = hold({ scope: body });
		const run = hold({ name: "branch:x", scope: body, section: null });
		expect(
			leavingHolds([section, run], {
				stepId: "call-step",
				scope: null,
				edges: [],
			}),
		).toEqual([section]);
	});
});

describe("holdCovers", () => {
	const steps: Record<string, { nodeId: string; scope: Scope | null }> = {
		"call-step": { nodeId: "up", scope: null },
	};
	const parentOf = (stepId: string) => steps[stepId] ?? null;

	test("given a lease of the whole run, then every node is inside it", () => {
		expect(
			holdCovers(
				hold({ section: null }),
				{ nodeId: "report", scope: null },
				parentOf,
			),
		).toBe(true);
	});

	test("given a node in the Section, then it is inside; one outside is not", () => {
		expect(holdCovers(hold(), { nodeId: "test", scope: null }, parentOf)).toBe(
			true,
		);
		expect(
			holdCovers(hold(), { nodeId: "report", scope: null }, parentOf),
		).toBe(false);
	});

	test("given a node in the flow of a Call step in the Section, then it is inside", () => {
		expect(holdCovers(hold(), { nodeId: "deep", scope: body }, parentOf)).toBe(
			true,
		);
	});
});
