import { describe, expect, test } from "bun:test";
import { inMemoryLearningEntries } from "../adapters/out/in-memory-neighbours";
import { readLearnsFromRuns } from "./read-learns-from-runs";

/** The use case readLearnsFromRuns, on in-memory adapters. */

describe("readLearnsFromRuns", () => {
	test("is on unless a person turned it off", async () => {
		const documents = inMemoryLearningEntries();
		const read = readLearnsFromRuns({ documents });
		expect(await read({ projectId: "p1" })).toBe(true);
		documents.learnsFromRuns.set("p1", false);
		expect(await read({ projectId: "p1" })).toBe(false);
	});
});
