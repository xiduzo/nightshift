import { describe, expect, test } from "bun:test";
import { inMemoryTargetsPorts } from "../adapters/out/in-memory-neighbours";
import { findTargets } from "./find-targets";

/** The use case findTargets, on in-memory adapters. */

describe("findTargets", () => {
	test("finds the targets by id and leaves out an id without one", async () => {
		const ports = inMemoryTargetsPorts();
		await ports.targetStore.upsert({
			id: "t1",
			personId: "ada",
			kind: "web",
			name: "Safari",
			platform: "",
			endpoint: "https://web.push.apple.com/a",
			keys: null,
			sessionId: null,
			at: 1_000,
		});
		const found = await findTargets(ports)({ ids: ["t1", "t9"] });
		expect(found.map((t) => t.id)).toEqual(["t1"]);
		expect(await findTargets(ports)({ ids: [] })).toEqual([]);
	});
});
