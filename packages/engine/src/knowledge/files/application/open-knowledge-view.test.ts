import { describe, expect, test } from "bun:test";
import { inMemoryFilesPorts } from "../adapters/out/in-memory-neighbours";
import type { KnowledgeFile } from "../domain/paths";
import { openKnowledgeView } from "./open-knowledge-view";
import type { WriteKnowledgeIndex } from "./write-knowledge-index";

/** The use case openKnowledgeView, on in-memory adapters. */

const file = (path: string): KnowledgeFile => ({
	path,
	size: 3,
	changedAt: 1,
});

function viewPorts() {
	const ports = inMemoryFilesPorts();
	const indexed: WriteKnowledgeIndex[] = [];
	return {
		ports,
		indexed,
		open: openKnowledgeView({
			views: ports.views,
			writeIndex: async (request) => {
				indexed.push(request);
			},
		}),
	};
}

describe("openKnowledgeView", () => {
	test("copies the files of the folders asked for, and indexes the copy", async () => {
		const { ports, indexed, open } = viewPorts();
		const view = await open({
			source: "/knowledge/p1",
			files: [file("books/a.md"), file("bookshelf/b.md"), file("notes.md")],
			folders: ["books", "notes.md"],
		});
		expect(ports.views.filesOf(view.path)).toEqual(["books/a.md", "notes.md"]);
		expect(indexed.map((request) => request.snapshot.dir)).toEqual([view.path]);
		await view.remove();
		expect(ports.views.removed).toEqual([view.path]);
	});

	test("a file that went since the look is left out", async () => {
		const { ports, open } = viewPorts();
		ports.views.gone.add("books/a.md");
		const view = await open({
			source: "/knowledge/p1",
			files: [file("books/a.md"), file("books/b.md")],
			folders: ["books"],
		});
		expect(ports.views.filesOf(view.path)).toEqual(["books/b.md"]);
	});

	test("a view whose index fails is removed, and the failure goes on", async () => {
		const ports = inMemoryFilesPorts();
		const open = openKnowledgeView({
			views: ports.views,
			writeIndex: async () => {
				throw new Error("The disk is full.");
			},
		});
		await expect(
			open({ source: "/knowledge/p1", files: [], folders: ["books"] }),
		).rejects.toThrow("The disk is full.");
		expect(ports.views.removed).toHaveLength(1);
	});
});
