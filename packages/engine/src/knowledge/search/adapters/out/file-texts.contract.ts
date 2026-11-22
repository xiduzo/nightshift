import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FileTexts } from "../../application/ports";

/** One adapter of `FileTexts` to test, over one folder. */
export type FileTextsUnderTest = {
	fileTexts: FileTexts;
	/** The folder the test puts its files in. */
	dir: string;
	/** Puts a text file in the folder, as a person would. */
	put(path: string, text: string): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `FileTexts` does.
 * `file-texts.contract.test.ts` runs it on the in-memory adapter and on the
 * real one.
 */
export function fileTextsContract(
	name: string,
	make: () => Promise<FileTextsUnderTest>,
): void {
	describe(`FileTexts contract: ${name}`, () => {
		let under: FileTextsUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("gives the start of a text file, at most the bytes asked", async () => {
			await under.put("notes/a.md", "Hello world");
			const { fileTexts, dir } = under;
			expect(await fileTexts.start(dir, "notes/a.md", 5)).toBe("Hello");
			expect(await fileTexts.start(dir, "notes/a.md", 1_000)).toBe(
				"Hello world",
			);
		});

		test("gives null for a file that is not there", async () => {
			const { fileTexts, dir } = under;
			expect(await fileTexts.start(dir, "gone.md", 10)).toBeNull();
			expect(await fileTexts.pages(dir, "gone.pdf")).toBeNull();
		});

		test("knows a PDF or Word file by its name", () => {
			const { fileTexts } = under;
			expect(fileTexts.isDocument("a.pdf")).toBe(true);
			expect(fileTexts.isDocument("b/c.DOCX")).toBe(true);
			expect(fileTexts.isDocument("c.md")).toBe(false);
		});
	});
}
