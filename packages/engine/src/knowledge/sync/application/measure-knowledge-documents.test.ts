import { describe, expect, test } from "bun:test";
import { inMemorySyncPorts } from "../adapters/out/in-memory-neighbours";
import { measureKnowledgeDocuments } from "./measure-knowledge-documents";

/** The use case measureKnowledgeDocuments, on in-memory adapters. */

describe("measureKnowledgeDocuments", () => {
	test("notes the size of each knowledge document", async () => {
		const ports = inMemorySyncPorts();
		ports.documents.listRaw("p1", "a.md", { sha256: "a" });
		ports.documents.listRaw("p2", "b.md", { sha256: "b" });
		await measureKnowledgeDocuments(ports)();
		expect(ports.notes.notes.map((note) => note.projectId)).toEqual([
			"p1",
			"p2",
		]);
		expect(ports.notes.notes.every((note) => note.bytes > 0)).toBe(true);
	});

	test("without notes, nothing goes anywhere", async () => {
		const ports = inMemorySyncPorts();
		ports.documents.listRaw("p1", "a.md", { sha256: "a" });
		await measureKnowledgeDocuments({ documents: ports.documents })();
		expect(ports.notes.notes).toEqual([]);
	});
});
