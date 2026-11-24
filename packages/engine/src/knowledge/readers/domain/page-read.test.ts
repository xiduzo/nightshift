import { describe, expect, test } from "bun:test";
import {
	absoluteLink,
	fingerprintOf,
	linksOfMarkdown,
	nameOfAddress,
	READER_USER_AGENT,
	readOrUnchanged,
} from "./page-read";

describe("a read of a page", () => {
	test("its fingerprint is of its title and Markdown, not of its bytes", () => {
		expect(fingerprintOf("A", "text")).toBe(fingerprintOf("A", "text"));
		expect(fingerprintOf("A", "text")).not.toBe(fingerprintOf("B", "text"));
		expect(fingerprintOf("A", "text")).toMatch(/^[0-9a-f]{64}$/);
	});

	test("a service's read is unchanged when its fingerprint is what the last read saw", () => {
		const page = {
			title: "Docs",
			markdown: "The docs.",
			links: [],
			contentType: "text/html",
		};
		const first = readOrUnchanged(page, undefined);
		expect(first).toMatchObject({ status: "read", title: "Docs" });
		if (first.status !== "read") return;
		expect(readOrUnchanged(page, first.mark)).toEqual({
			status: "unchanged",
			mark: first.mark,
		});
		expect(
			readOrUnchanged({ ...page, markdown: "New docs." }, first.mark),
		).toMatchObject({ status: "read" });
	});

	test("the links of Markdown are absolute, once each, without a fragment, and only of the web", () => {
		expect(
			linksOfMarkdown(
				"See [A](/docs/a), [B](https://example.org/b#x), [A again](</docs/a>) and [mail](mailto:x@example.com).",
				"https://example.com/docs/",
			),
		).toEqual(["https://example.com/docs/a", "https://example.org/b"]);
		expect(absoluteLink("ftp://example.com/x")).toBeNull();
		expect(absoluteLink("not a link")).toBeNull();
	});

	test("a page with no title is named by the last part of its address", () => {
		expect(nameOfAddress("https://example.com/docs/caf%C3%A9")).toBe("café");
		expect(nameOfAddress("https://example.com/")).toBe("example.com");
		expect(nameOfAddress("not a link")).toBe("not a link");
	});

	test("a request names the product, never the person", () => {
		expect(READER_USER_AGENT).toBe(
			"NightShift-knowledge/1 (+https://github.com/xiduzo/nightshift)",
		);
	});
});
