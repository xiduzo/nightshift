import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ReaderServices } from "../../application/ports";

/** One adapter of `ReaderServices` to test, over a site the test fills. */
export type ReaderServicesUnderTest = {
	services: ReaderServices;
	/** The web address of a page of the site, by its path. */
	url(path: string): string;
	/** Puts a page at `path` with this title and text. */
	publish(path: string, page: { title: string; text: string }): void;
	close(): Promise<void>;
};

const TEXT =
	"Refunds take fourteen days after we receive the item back. ".repeat(8);

/**
 * What every adapter of `ReaderServices` does.
 * `reader-services.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function readerServicesContract(
	name: string,
	make: () => Promise<ReaderServicesUnderTest>,
): void {
	describe(`ReaderServices contract: ${name}`, () => {
		let under: ReaderServicesUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("Night Shift's own reader reads the pages a look sees", async () => {
			under.publish("/docs/refunds", { title: "Refund policy", text: TEXT });
			const url = under.url("/docs/refunds");
			expect(under.services.local.kind).toBe("nightshift");
			const looked = await under.services.look(url, { timeoutMs: 8_000 });
			expect(looked.url).toBe(url);
			expect(looked.seen).toMatchObject({
				kind: "html",
				title: "Refund policy",
			});
			expect(await under.services.local.read(url, {})).toMatchObject({
				status: "read",
				title: "Refund policy",
			});
		});

		test("a look at a page that is not there sees it gone", async () => {
			const looked = await under.services.look(under.url("/missing"), {});
			expect(looked.seen).toEqual({
				status: "gone",
				reason: "The page is not there any more.",
			});
		});

		test("makes the reader of a service, of its kind", () => {
			const jina = under.services.service("jina", {
				address: "https://r.jina.ai/",
			});
			const firecrawl = under.services.service("firecrawl", {
				address: "https://crawl.example",
				key: "fc-1",
			});
			expect(jina.kind).toBe("jina");
			expect(firecrawl.kind).toBe("firecrawl");
			expect(typeof firecrawl.map).toBe("function");
		});
	});
}
