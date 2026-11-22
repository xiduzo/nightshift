import type { AddressRules } from "../../../../web-access";
import type { SiteFacts } from "../../application/ports";
import { READER_USER_AGENT } from "../../domain/page-read";
import {
	cleanAddress,
	parseRobots,
	type Robots,
	sitemapLocs,
} from "../../domain/site";
import { fetchGuarded } from "./fetch-guarded";

/**
 * What a site says about itself to readers, over the web: its robots.txt and
 * its sitemaps, read as the Web pages kit reads them (`web-source.ts` of
 * `@nightshift/flows`), for the quick look at a link.
 */

/** The most sitemap files one look reads, sitemap indexes included. */
const MAX_SITEMAPS = 5;

const MAX_BYTES = 5 * 1024 * 1024;

async function text(
	url: string,
	rules: AddressRules,
	signal: AbortSignal,
): Promise<string | null> {
	const fetched = await fetchGuarded(url, {
		headers: { "user-agent": READER_USER_AGENT },
		signal,
		timeoutMs: 8_000,
		maxBytes: MAX_BYTES,
		rules,
	});
	if (fetched.kind !== "response" || fetched.status !== 200) return null;
	return new TextDecoder().decode(fetched.body);
}

/** `rules`: where a reader of this computer may connect now, read at each call. */
export function webSiteFacts(deps: { rules: () => AddressRules }): SiteFacts {
	return {
		/** The site's robots.txt. None, or one that does not load: nothing blocked, no sitemap named. */
		async robots(origin, signal) {
			const found = await text(
				`${origin}/robots.txt`,
				deps.rules(),
				signal,
			).catch(() => null);
			return found === null
				? { blocked: [], sitemaps: [] }
				: parseRobots(origin, found);
		},
		/**
		 * The pages the sitemaps list, cleaned and once each: the sitemaps
		 * robots.txt names, else `<origin>/sitemap.xml`, one level of sitemap
		 * index, at most `MAX_SITEMAPS` files.
		 */
		async sitemapPages(origin: string, robots: Robots, signal: AbortSignal) {
			const rules = deps.rules();
			const todo =
				robots.sitemaps.length > 0
					? [...robots.sitemaps]
					: [`${origin}/sitemap.xml`];
			const pages = new Set<string>();
			let read = 0;
			while (todo.length > 0 && read < MAX_SITEMAPS && !signal.aborted) {
				const map = todo.shift() as string;
				read++;
				const xml = await text(map, rules, signal).catch(() => null);
				if (xml === null) continue;
				const { index, locs } = sitemapLocs(xml);
				if (index) todo.push(...locs);
				else for (const loc of locs) pages.add(cleanAddress(loc));
			}
			return [...pages];
		},
	};
}
