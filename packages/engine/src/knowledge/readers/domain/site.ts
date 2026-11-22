/**
 * What a site says about itself to readers, read as the Web pages kit reads
 * it (`web-source.ts` of `@nightshift/flows`): its robots.txt, and the
 * addresses and folders the quick look compares.
 */

export type Robots = {
	/** Address prefixes the site asks every reader to stay away from. */
	blocked: string[];
	/** Where its sitemaps are. */
	sitemaps: string[];
};

/**
 * The `Disallow` lines of the `User-agent: *` group, as address prefixes
 * (a `*` ends the prefix, a final `$` is dropped), and the `Sitemap:`
 * lines. `Allow` lines do not lift a `Disallow`: a reader reads less,
 * never more.
 */
export function parseRobots(origin: string, text: string): Robots {
	const blocked: string[] = [];
	const sitemaps: string[] = [];
	let agents = false;
	let applies = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/#.*/, "");
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		if (key === "user-agent") {
			if (!agents) applies = false;
			agents = true;
			if (value === "*") applies = true;
			continue;
		}
		agents = false;
		if (key === "disallow" && applies && value !== "") {
			blocked.push(`${origin}${value.replace(/\*.*/, "").replace(/\$$/, "")}`);
		} else if (key === "sitemap" && value !== "") {
			sitemaps.push(value);
		}
	}
	return { blocked, sitemaps };
}

/** The address without its `#fragment` and `?query`, as the kit cleans one. */
export const cleanAddress = (url: string) =>
	url.replace(/#.*/, "").replace(/\?.*/, "");

/** The folder of an address: https://example.com/docs/intro gives https://example.com/docs/. */
export function folderOf(url: string): string {
	const clean = cleanAddress(url);
	return /^[A-Za-z]+:\/\/[^/]+\//.test(clean)
		? clean.replace(/[^/]*$/, "")
		: `${clean}/`;
}

/** The addresses a sitemap file lists, and whether it is an index of more sitemaps. */
export function sitemapLocs(xml: string): { index: boolean; locs: string[] } {
	const locs = [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((match) =>
		(match[1] ?? "").replace(/&amp;/g, "&"),
	);
	return { index: /<sitemapindex/.test(xml), locs };
}
