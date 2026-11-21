import { describe, expect, test } from "bun:test";
import { inMemoryFilesPorts } from "../adapters/out/in-memory-neighbours";
import { listDocumentFiles } from "./list-document-files";

/** The use case listDocumentFiles, on in-memory adapters. */

const entry = { sha256: "a".repeat(64), size: 1, changedAt: 1, deviceId: "d" };

describe("listDocumentFiles", () => {
	test("the document's files by path, without the question set and the proposed learnings, and no reconcile", async () => {
		const ports = inMemoryFilesPorts();
		ports.documents.list("p1", "b.md", entry);
		ports.documents.list("p1", "a.md", entry);
		ports.documents.list("p1", "evals/questions.json", entry);
		ports.documents.list("p1", "learnings/proposed/run-1.md", entry);
		const files = await listDocumentFiles(ports)({ projectId: "p1" });
		expect(files.map((file) => file.path)).toEqual(["a.md", "b.md"]);
		expect(ports.sync.asked).toEqual([]);
	});
});
