import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { KnowledgeFolders } from "../../application/ports";

/** One adapter of `KnowledgeFolders` to test, and how a test puts a file where a sync would write it. */
export type KnowledgeFoldersUnderTest = {
	knowledgeFolders: KnowledgeFolders;
	put(projectId: string, path: string, text: string): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `KnowledgeFolders` does.
 * `knowledge-folders.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function knowledgeFoldersContract(
	name: string,
	make: () => Promise<KnowledgeFoldersUnderTest>,
): void {
	describe(`KnowledgeFolders contract: ${name}`, () => {
		let under: KnowledgeFoldersUnderTest;
		let folders: KnowledgeFolders;
		beforeEach(async () => {
			under = await make();
			folders = under.knowledgeFolders;
		});
		afterEach(async () => {
			await under.close();
		});

		test("a project with no folder: none known, an empty look, no file", async () => {
			expect(await folders.known()).toEqual([]);
			expect((await folders.scan("p1")).files).toEqual([]);
			expect(await folders.read("p1", "a.md", 100)).toBeNull();
		});

		test("a folder made is known, and each project has its own", async () => {
			const one = await folders.ensure("p1");
			await folders.ensure("p2");
			expect(one).toBe(folders.folder("p1"));
			expect(folders.folder("p1")).not.toBe(folders.folder("p2"));
			expect(await folders.known()).toEqual(["p1", "p2"]);
		});

		test("a file reads back by its path, cut at the size asked for", async () => {
			await folders.ensure("p1");
			await under.put("p1", "notes/a.md", "# Title\n\nThe text.\n");
			const look = await folders.scan("p1");
			expect(look.files.map((file) => file.path)).toEqual(["notes/a.md"]);
			expect(look.readable.map((file) => file.path)).toEqual(["notes/a.md"]);
			const read = await folders.read("p1", "./notes/a.md", 7);
			expect(read).toMatchObject({
				path: "notes/a.md",
				title: "Title",
				text: "# Title",
				size: 19,
				truncated: true,
			});
		});

		test("a path a person does not read is no file", async () => {
			await folders.ensure("p1");
			await under.put("p1", "learnings/proposed/x.md", "- a note\n");
			expect(await folders.read("p1", "../a.md", 100)).toBeNull();
			expect(
				await folders.read("p1", "learnings/proposed/x.md", 100),
			).toBeNull();
		});
	});
}
