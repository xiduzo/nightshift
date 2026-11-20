import { describe, expect, test } from "bun:test";
import { inMemorySpacesPorts } from "../adapters/out/in-memory-neighbours";
import { listSpaceIds } from "./list-space-ids";

describe("listSpaceIds", () => {
	test("names every Space of this Replica", async () => {
		const ports = inMemorySpacesPorts();
		expect(await listSpaceIds(ports)()).toEqual([]);
		await ports.spaceStore.mirror({ id: "host", name: "Platform" });
		expect(await listSpaceIds(ports)()).toEqual(["host"]);
	});
});
