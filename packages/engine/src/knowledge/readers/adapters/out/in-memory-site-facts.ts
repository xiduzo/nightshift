import type { SiteFacts } from "../../application/ports";
import {
	cleanAddress,
	parseRobots,
	type Robots,
	sitemapLocs,
} from "../../domain/site";

/**
 * `SiteFacts` in memory. A test serves the text of a site's files
 * (`serve`): its robots.txt and its sitemaps. They read by the same rules
 * as the real adapter: the sitemaps robots.txt names, else
 * `<origin>/sitemap.xml`, one level of sitemap index, at most 5 files.
 */
export function inMemorySiteFacts() {
	const files = new Map<string, string>();
	const twin = {
		/** Every file asked for, in order. */
		asked: [] as string[],
		/** Serves `text` at the address `url`. */
		serve(url: string, text: string) {
			files.set(url, text);
		},
		async robots(origin: string, _signal: AbortSignal): Promise<Robots> {
			const url = `${origin}/robots.txt`;
			twin.asked.push(url);
			const text = files.get(url);
			return text === undefined
				? { blocked: [], sitemaps: [] }
				: parseRobots(origin, text);
		},
		async sitemapPages(
			origin: string,
			robots: Robots,
			signal: AbortSignal,
		): Promise<string[]> {
			const todo =
				robots.sitemaps.length > 0
					? [...robots.sitemaps]
					: [`${origin}/sitemap.xml`];
			const pages = new Set<string>();
			let read = 0;
			while (todo.length > 0 && read < 5 && !signal.aborted) {
				const map = todo.shift() as string;
				read++;
				twin.asked.push(map);
				const xml = files.get(map);
				if (xml === undefined) continue;
				const { index, locs } = sitemapLocs(xml);
				if (index) todo.push(...locs);
				else for (const loc of locs) pages.add(cleanAddress(loc));
			}
			return [...pages];
		},
	};
	return twin satisfies SiteFacts;
}

export type InMemorySiteFacts = ReturnType<typeof inMemorySiteFacts>;
