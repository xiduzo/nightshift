import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FolderIndex } from "../../application/ports";

/** One adapter of `FolderIndex` to test, a folder of its own, and how a test puts a file in it. */
export type FolderIndexUnderTest = {
	folderIndex: FolderIndex;
	dir: string;
	put(path: string, text: string): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `FolderIndex` does.
 * `folder-index.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function folderIndexContract(
	name: string,
	make: () => Promise<FolderIndexUnderTest>,
): void {
	describe(`FolderIndex contract: ${name}`, () => {
		let under: FolderIndexUnderTest;
		let index: FolderIndex;
		beforeEach(async () => {
			under = await make();
			index = under.folderIndex;
		});
		afterEach(async () => {
			await under.close();
		});

		test("a folder with no index has none", async () => {
			expect(await index.written(under.dir)).toBeNull();
		});

		test("an index written reads back", async () => {
			await index.write(under.dir, "# Knowledge index\n");
			const written = await index.written(under.dir);
			expect(written?.text).toBe("# Knowledge index\n");
			expect(typeof written?.mtimeMs).toBe("number");
		});

		test("a text file gives the start of its text, any other file nothing", async () => {
			await under.put("a.md", "# A\n\nThe text.\n");
			await under.put("b.bin", "data");
			expect(await index.source(under.dir, "a.md")).toEqual({
				text: "# A\n\nThe text.\n",
			});
			expect(await index.source(under.dir, "b.bin")).toEqual({ text: "" });
		});

		test("the head of a file, and its whole size; none for a file that is not there", async () => {
			await under.put("a.md", "# A\n\nThe text.\n");
			expect(await index.head(under.dir, "a.md", 3)).toEqual({
				text: "# A",
				size: 15,
			});
			expect(await index.head(under.dir, "gone.md", 3)).toBeNull();
		});
	});
}
