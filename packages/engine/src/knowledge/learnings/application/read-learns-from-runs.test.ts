import { describe, expect, test } from "bun:test";
import { inMemoryKnowledgeDocuments } from "../../sync/adapters/out/in-memory-knowledge-documents";
import { readLearnsFromRuns } from "./read-learns-from-runs";

/** The use case readLearnsFromRuns, on in-memory adapters. */

describe("readLearnsFromRuns", () => {
	test("is on unless a person turned it off", async () => {
		const documents = inMemoryKnowledgeDocuments();
		const read = readLearnsFromRuns({ documents });
		expect(await read({ projectId: "p1" })).toBe(true);
		await (await documents.open("p1")).setLearnsFromRuns(false);
		expect(await read({ projectId: "p1" })).toBe(false);
	});
});
