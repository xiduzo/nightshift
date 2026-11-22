import { describe, expect, test } from "bun:test";
import { isPageAddress, mapLimit, NOT_A_PAGE, pageFile } from "./step-reads";

describe("what a step gets of its page reader", () => {
	test("a page's file: its title and address above its Markdown", () => {
		expect(
			pageFile("https://example.com/a", {
				status: "read",
				title: ' Refund\n "policy" ',
				markdown: "\nGift cards are final.\n\n",
				links: [],
				mark: { fingerprint: "f" },
				contentType: "text/html",
			}),
		).toBe(
			'---\ntitle: "Refund \\"policy\\""\nsource: https://example.com/a\n---\n\nGift cards are final.\n',
		);
	});

	test("a step must give a web address", () => {
		expect(NOT_A_PAGE).toBe("Give the page as url=https://…");
		expect(isPageAddress("HTTPS://example.com")).toBe(true);
		expect(isPageAddress("example.com")).toBe(false);
	});

	test("a map gives 100 addresses unless the step asks 1 to 5,000", () => {
		expect(mapLimit(null)).toBe(100);
		expect(mapLimit("not a number")).toBe(100);
		expect(mapLimit("0")).toBe(100);
		expect(mapLimit("-3")).toBe(1);
		expect(mapLimit("20")).toBe(20);
		expect(mapLimit("999999")).toBe(5_000);
	});
});
