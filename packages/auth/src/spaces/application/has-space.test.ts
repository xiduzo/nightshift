import { describe, expect, test } from "bun:test";
import { inMemorySpacesPorts } from "../adapters/out/in-memory-neighbours";
import { hasSpace } from "./has-space";

describe("hasSpace", () => {
	test("is true for a Space of this Replica only", async () => {
		const ports = inMemorySpacesPorts();
		ports.spaceStore.records.spaces.push({
			id: "platform",
			name: "Platform",
			slug: "platform",
			personal: false,
		});
		expect(await hasSpace(ports)({ spaceId: "platform" })).toBe(true);
		expect(await hasSpace(ports)({ spaceId: "gone" })).toBe(false);
	});
});
