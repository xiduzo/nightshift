import { describe, expect, test } from "bun:test";
import type { SectionSplitter } from "../../application/ports";

/**
 * What every adapter of `SectionSplitter` does.
 * `section-splitter.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function sectionSplitterContract(
	name: string,
	make: () => SectionSplitter,
): void {
	describe(`SectionSplitter contract: ${name}`, () => {
		test("gives a file with no text one empty section, so its path still finds it", async () => {
			expect(await make().split("empty.txt", "  \n")).toEqual([
				expect.objectContaining({
					pageContent: "",
					metadata: {
						path: "empty.txt",
						heading: null,
						headingPath: "",
						line: 1,
						page: null,
					},
				}),
			]);
		});

		test("puts a short markdown text in one section, under the heading open where it starts", async () => {
			const sections = await make().split(
				"guide.md",
				"# Guide\n\nA short text.",
			);
			expect(sections).toHaveLength(1);
			expect(sections[0]?.pageContent).toBe("# Guide\n\nA short text.");
			expect(sections[0]?.metadata).toEqual({
				path: "guide.md",
				heading: "Guide",
				headingPath: "Guide",
				line: 1,
				page: null,
			});
		});

		test("keeps a document's pages, and leaves a page with no text out", async () => {
			const sections = await make().split("a.pdf", [
				{ pageContent: "Page one.", metadata: { loc: { pageNumber: 1 } } },
				{ pageContent: " ", metadata: { loc: { pageNumber: 2 } } },
				{ pageContent: "Page three.", metadata: { loc: { pageNumber: 3 } } },
			]);
			expect(sections.map((s) => [s.pageContent, s.metadata.page])).toEqual([
				["Page one.", 1],
				["Page three.", 3],
			]);
		});
	});
}
