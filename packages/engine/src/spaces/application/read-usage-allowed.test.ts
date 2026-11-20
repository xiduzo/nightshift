import { describe, expect, test } from "bun:test";
import { inMemorySpacesPorts } from "../adapters/out/in-memory-neighbours";
import { readUsageAllowed } from "./read-usage-allowed";

/** The use case readUsageAllowed, on in-memory adapters. */

describe("readUsageAllowed", () => {
	test("allowed while no Space turned usage off, missing means on", async () => {
		const ports = inMemorySpacesPorts();
		expect(await readUsageAllowed(ports)()).toBe(true);
		ports.spacePolicies.add("a");
		ports.spacePolicies.add("b", true);
		expect(await readUsageAllowed(ports)()).toBe(true);
	});

	test("one Space with usage off is enough to say no", async () => {
		const ports = inMemorySpacesPorts();
		ports.spacePolicies.add("a", true);
		ports.spacePolicies.add("b", false);
		expect(await readUsageAllowed(ports)()).toBe(false);
	});
});
