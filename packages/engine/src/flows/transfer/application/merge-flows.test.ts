import { describe, expect, test } from "bun:test";
import { inMemoryTransferPorts } from "../adapters/out/in-memory-neighbours";
import { mergeFlows } from "./merge-flows";

describe("mergeFlows", () => {
	test("merges at the time of the clock, with the Persons when given", async () => {
		const ports = inMemoryTransferPorts();
		const merge = mergeFlows(ports);
		expect(await merge({ source: "a", destination: "b" })).toBe(
			ports.merges.plan,
		);
		await merge({ source: "a", destination: "b", persons: { ada: "ada-2" } });
		expect(ports.merges.calls).toEqual([
			{ verb: "merge", source: "a", destination: "b", with: { at: 1000 } },
			{
				verb: "merge",
				source: "a",
				destination: "b",
				with: { persons: { ada: "ada-2" }, at: 1000 },
			},
		]);
	});
});
