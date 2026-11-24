import { describe, expect, test } from "bun:test";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { listKnownLearnings } from "./list-known-learnings";

/** The use case listKnownLearnings, on in-memory adapters. */

describe("listKnownLearnings", () => {
	test("gives the waiting notes newest first, then the kept ones, and asks no Host", async () => {
		const ports = inMemoryLearningsPorts();
		const files: [string, string, number][] = [
			["learnings/proposed/run-1.s1.md", "- Old.\n", 1],
			["learnings/proposed/run-2.s1.md", "- New.\n", 2],
			["learnings/accepted/run-0.md", "- Kept.\n", 0],
			["learnings/proposed/run-3.s1.md", "", 3],
		];
		for (const [path, text, at] of files) {
			const where = text ? "here" : "nowhere";
			await ports.sync.publish("p1", path, text, at, where);
		}
		expect(await listKnownLearnings(ports)({ projectId: "p1" })).toEqual([
			"New.",
			"Old.",
			"Kept.",
		]);
		expect(ports.archive.calls).toEqual([]);
	});
});
