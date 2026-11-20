import { describe, expect, test } from "bun:test";
import { inMemorySpacesPorts } from "../adapters/out/in-memory-neighbours";
import { mirrorHostSpace } from "./mirror-host-space";

describe("mirrorHostSpace", () => {
	test("makes the Host's Space, then keeps its name in step", async () => {
		const ports = inMemorySpacesPorts();
		const mirror = mirrorHostSpace(ports);
		await mirror({ id: "host", name: "Platform" });
		await mirror({ id: "host", name: "Platform 2" });
		expect(ports.spaceStore.records.spaces).toEqual([
			{ id: "host", name: "Platform 2", slug: "host-host", personal: false },
		]);
	});
});
