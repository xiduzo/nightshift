import { describe, expect, test } from "bun:test";
import { cleanAddress, folderOf, parseRobots, sitemapLocs } from "./site";

const ORIGIN = "https://example.com";

describe("what a site says to readers", () => {
	test("robots.txt: the Disallow lines of every reader's group, and the sitemaps", () => {
		const text = [
			"User-agent: Googlebot",
			"Disallow: /only-google",
			"",
			"User-agent: *",
			"Disallow: /private*",
			"Disallow: /exact$",
			"Allow: /private/open",
			"Disallow:",
			"# Disallow: /comment",
			`Sitemap: ${ORIGIN}/map.xml`,
		].join("\r\n");
		expect(parseRobots(ORIGIN, text)).toEqual({
			blocked: [`${ORIGIN}/private`, `${ORIGIN}/exact`],
			sitemaps: [`${ORIGIN}/map.xml`],
		});
	});

	test("an address is cleaned of its query and fragment; its folder ends with a slash", () => {
		expect(cleanAddress(`${ORIGIN}/docs/a?x=1#top`)).toBe(`${ORIGIN}/docs/a`);
		expect(folderOf(`${ORIGIN}/docs/intro`)).toBe(`${ORIGIN}/docs/`);
		expect(folderOf(`${ORIGIN}/docs/`)).toBe(`${ORIGIN}/docs/`);
		expect(folderOf(ORIGIN)).toBe(`${ORIGIN}/`);
	});

	test("a sitemap lists its addresses, and says when it is an index", () => {
		expect(
			sitemapLocs(
				`<urlset><url><loc> ${ORIGIN}/a?x=1&amp;y=2 </loc></url></urlset>`,
			),
		).toEqual({ index: false, locs: [`${ORIGIN}/a?x=1&y=2`] });
		expect(
			sitemapLocs(
				`<sitemapindex><sitemap><loc>${ORIGIN}/b.xml</loc></sitemap></sitemapindex>`,
			),
		).toEqual({ index: true, locs: [`${ORIGIN}/b.xml`] });
	});
});
