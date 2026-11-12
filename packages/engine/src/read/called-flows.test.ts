import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import { calledFlows } from "./called-flows";

type Call = {
	id: string;
	nodeId: string;
	scope: { parentStepId: string } | null;
	logged: string | null;
};

const call = (
	id: string,
	nodeId: string,
	parent: string | null,
	logged: string | null = null,
): Call => ({
	id,
	nodeId,
	scope: parent ? { parentStepId: parent } : null,
	logged,
});

const copies = {
	flow: { nodes: [{ id: "build", type: "call", flow: "feature" }] },
	calledFlows: {
		feature: { nodes: [{ id: "each", type: "call", flow: "trace" }] },
		other: { nodes: [{ id: "each", type: "call", flow: "lint" }] },
	},
} as unknown as { flow: Flow; calledFlows: Record<string, Flow> };

describe("calledFlows", () => {
	test("the logged name comes first, and the copies are read only without one", () => {
		let reads = 0;
		const read = () => {
			reads++;
			return copies;
		};
		const steps = [call("c1", "build", null, "feature")];
		const once = calledFlows(steps, read, (step) => step.logged);
		expect(once.calls(steps[0] as Call)).toBe("feature");
		expect(reads).toBe(0);

		// A Call with `each` has no logged name: its node in the flow above.
		const each = [call("c1", "build", null, "other"), call("c2", "each", "c1")];
		const walk = calledFlows(each, read, (step) => step.logged);
		expect(walk.calls(each[1] as Call)).toBe("lint");
		expect(walk.ranIn(each[1] as Call)).toBe("other");
		expect(reads).toBe(1);
	});

	test("without a logged name, every name comes from the copies", () => {
		const steps = [call("c1", "build", null), call("c2", "each", "c1")];
		const walk = calledFlows(steps, () => copies);
		expect(steps.map((s) => [walk.ranIn(s), walk.calls(s)])).toEqual([
			[null, "feature"],
			["feature", "trace"],
		]);
	});
});
