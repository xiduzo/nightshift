import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ContentTexts } from "../../application/ports";

/** One adapter of `ContentTexts` to test. */
export type ContentTextsUnderTest = {
	contentTexts: ContentTexts;
	close(): Promise<void>;
};

const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * What every adapter of `ContentTexts` does.
 * `content-texts.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function contentTextsContract(
	name: string,
	make: () => Promise<ContentTextsUnderTest>,
): void {
	describe(`ContentTexts contract: ${name}`, () => {
		let under: ContentTextsUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a text file from its content, cut at the size asked for", async () => {
			const read = await under.contentTexts.text(
				"./a.md",
				bytes("# Title\n\nThe text.\n"),
				7,
			);
			expect(read).toEqual({
				path: "a.md",
				title: "Title",
				text: "# Title",
				size: 19,
				truncated: true,
			});
		});

		test("a path a person does not read is no file", async () => {
			expect(
				await under.contentTexts.text(
					"learnings/proposed/x.md",
					bytes("x"),
					10,
				),
			).toBeNull();
		});

		test("content that is not text is refused", async () => {
			await expect(
				under.contentTexts.text("a.txt", new Uint8Array([97, 0, 98]), 10),
			).rejects.toThrow('"a.txt" is not a text file.');
		});
	});
}
