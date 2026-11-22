import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PageReader } from "../../application/ports";

/** One adapter of `PageReader` to test, over a site the test fills. */
export type PageReaderUnderTest = {
	reader: PageReader;
	/** The web address of a page of the site, by its path. */
	url(path: string): string;
	/** Puts a page at `path` with this title and text, or changes it. */
	publish(path: string, page: { title: string; text: string }): void;
	close(): Promise<void>;
};

/** A text long enough to read as a page's main content. */
const TEXT =
	"Refunds take fourteen days after we receive the item back. ".repeat(8);

/**
 * What every adapter of `PageReader` does.
 * `page-reader.contract.test.ts` runs it on the in-memory adapter and on
 * the real ones.
 */
export function pageReaderContract(
	name: string,
	make: () => Promise<PageReaderUnderTest>,
): void {
	describe(`PageReader contract: ${name}`, () => {
		let under: PageReaderUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("reads a page as its title and its text, with a mark", async () => {
			under.publish("/docs/refunds", { title: "Refund policy", text: TEXT });
			const read = await under.reader.read(under.url("/docs/refunds"), {});
			expect(read.status).toBe("read");
			if (read.status !== "read") return;
			expect(read.title).toBe("Refund policy");
			expect(read.markdown).toContain("Refunds take fourteen days");
			expect(read.mark.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		});

		test("a page read again with its mark is unchanged, until its text changes", async () => {
			under.publish("/docs/refunds", { title: "Refund policy", text: TEXT });
			const url = under.url("/docs/refunds");
			const first = await under.reader.read(url, {});
			if (first.status !== "read") throw new Error("not read");
			expect(
				await under.reader.read(url, { before: first.mark }),
			).toMatchObject({ status: "unchanged" });
			under.publish("/docs/refunds", {
				title: "Refund policy",
				text: `${TEXT} Gift cards are final.`,
			});
			expect(
				await under.reader.read(url, { before: first.mark }),
			).toMatchObject({ status: "read" });
		});

		test("a page that is not there is gone, with why", async () => {
			expect(await under.reader.read(under.url("/missing"), {})).toEqual({
				status: "gone",
				reason: "The page is not there any more.",
			});
		});
	});
}
