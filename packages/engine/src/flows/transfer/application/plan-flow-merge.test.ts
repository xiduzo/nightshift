import { describe, expect, test } from "bun:test";
import { inMemoryTransferPorts } from "../adapters/out/in-memory-neighbours";
import { planFlowMerge } from "./plan-flow-merge";

describe("planFlowMerge", () => {
	test("asks the documents for the plan, with no Person when none is given", async () => {
		const ports = inMemoryTransferPorts();
		ports.merges.plan = { flows: { build: "build-2" }, schedules: {} };
		const plan = planFlowMerge(ports);
		expect(await plan({ source: "a", destination: "b" })).toBe(
			ports.merges.plan,
		);
		await plan({ source: "a", destination: "b", persons: { ada: "ada-2" } });
		expect(ports.merges.calls).toEqual([
			{ verb: "plan", source: "a", destination: "b", with: {} },
			{ verb: "plan", source: "a", destination: "b", with: { ada: "ada-2" } },
		]);
	});
});
