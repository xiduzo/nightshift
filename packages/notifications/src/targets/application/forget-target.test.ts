import { describe, expect, test } from "bun:test";
import { inMemoryTargetsPorts } from "../adapters/out/in-memory-neighbours";
import { forgetTarget } from "./forget-target";

/** The use case forgetTarget, on in-memory adapters. */

describe("forgetTarget", () => {
	test("forgets one target, and only that one", async () => {
		const ports = inMemoryTargetsPorts();
		for (const id of ["t1", "t2"]) {
			await ports.targetStore.upsert({
				id,
				personId: "ada",
				kind: "web",
				name: "Safari",
				platform: "",
				endpoint: `https://web.push.apple.com/${id}`,
				keys: null,
				sessionId: null,
				at: 1_000,
			});
		}
		await forgetTarget(ports)({ id: "t1" });
		expect(ports.targetStore.all().map((t) => t.id)).toEqual(["t2"]);
	});
});
