import { describe, expect, test } from "bun:test";
import { inMemoryFilesPorts } from "../adapters/out/in-memory-neighbours";
import { listKnowledgeFiles } from "./list-knowledge-files";

/** The use case listKnowledgeFiles, on in-memory adapters. */

const entry = (changedAt: number, local?: true) => ({
	sha256: "a".repeat(64),
	size: 3,
	changedAt,
	deviceId: "desktop",
	...(local ? { local } : {}),
});

describe("listKnowledgeFiles", () => {
	test("lists the document's files after a reconcile, and counts the proposed notes", async () => {
		const ports = inMemoryFilesPorts();
		ports.documents.list("p1", "wiki/b.md", entry(2));
		ports.documents.list("p1", "a.md", entry(1, true));
		ports.documents.list("p1", "learnings/proposed/run-1.md", entry(3));
		ports.notes.notes = 2;
		const listing = await listKnowledgeFiles(ports)({ projectId: "p1" });
		expect(ports.sync.asked).toEqual(["p1"]);
		expect(ports.wait.waits).toEqual([2_000]);
		expect(listing).toEqual({
			files: [
				{ path: "a.md", size: 3, changedAt: 1, local: true },
				{ path: "wiki/b.md", size: 3, changedAt: 2 },
			],
			proposed: 2,
			shared: true,
			olderHost: false,
			learnsFromRuns: true,
			reader: { kind: "nightshift" },
		});
	});

	test("a reconcile that does not end holds the page no longer than the wait", async () => {
		const ports = inMemoryFilesPorts();
		ports.sync.hang();
		ports.documents.list("p1", "a.md", entry(1));
		const listing = await listKnowledgeFiles(ports)({ projectId: "p1" });
		expect(listing.files.map((file) => file.path)).toEqual(["a.md"]);
	});

	test("a project with no Space is not shared, and has no older Host", async () => {
		const ports = inMemoryFilesPorts();
		ports.status.setSpace("p1", null);
		ports.status.older = true;
		const listing = await listKnowledgeFiles(ports)({ projectId: "p1" });
		expect(listing.shared).toBe(false);
		expect(listing.olderHost).toBe(false);
	});
});
