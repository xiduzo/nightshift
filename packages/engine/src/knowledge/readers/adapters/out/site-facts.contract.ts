import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SiteFacts } from "../../application/ports";

/** One adapter of `SiteFacts` to test, over a site the test fills. */
export type SiteFactsUnderTest = {
	facts: SiteFacts;
	/** The site's origin: `https://example.com`. */
	origin: string;
	/** Serves `text` at `path` of the site. */
	serve(path: string, text: string): void;
	close(): Promise<void>;
};

/**
 * What every adapter of `SiteFacts` does.
 * `site-facts.contract.test.ts` runs it on the in-memory adapter and on
 * the real one.
 */
export function siteFactsContract(
	name: string,
	make: () => Promise<SiteFactsUnderTest>,
): void {
	describe(`SiteFacts contract: ${name}`, () => {
		let under: SiteFactsUnderTest;
		const signal = new AbortController().signal;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a site without robots.txt blocks nothing and names no sitemap", async () => {
			expect(await under.facts.robots(under.origin, signal)).toEqual({
				blocked: [],
				sitemaps: [],
			});
		});

		test("reads what robots.txt blocks for every reader, and its sitemaps", async () => {
			const { origin } = under;
			under.serve(
				"/robots.txt",
				`User-agent: *\nDisallow: /private*\nSitemap: ${origin}/map.xml`,
			);
			expect(await under.facts.robots(origin, signal)).toEqual({
				blocked: [`${origin}/private`],
				sitemaps: [`${origin}/map.xml`],
			});
		});

		test("lists the pages of the sitemaps, cleaned and once each, through one sitemap index", async () => {
			const { origin } = under;
			under.serve(
				"/sitemap.xml",
				`<sitemapindex><sitemap><loc>${origin}/a.xml</loc></sitemap></sitemapindex>`,
			);
			under.serve(
				"/a.xml",
				`<urlset><url><loc>${origin}/docs/a?x=1</loc></url><url><loc>${origin}/docs/a</loc></url><url><loc>${origin}/docs/b#top</loc></url></urlset>`,
			);
			const robots = { blocked: [], sitemaps: [] };
			expect(await under.facts.sitemapPages(origin, robots, signal)).toEqual([
				`${origin}/docs/a`,
				`${origin}/docs/b`,
			]);
		});

		test("a sitemap that does not load lists nothing", async () => {
			const robots = { blocked: [], sitemaps: [`${under.origin}/none.xml`] };
			expect(
				await under.facts.sitemapPages(under.origin, robots, signal),
			).toEqual([]);
		});
	});
}
