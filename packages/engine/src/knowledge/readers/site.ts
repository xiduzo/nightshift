import type { AddressRules } from "../../web-access";
import { fetchGuarded } from "./fetch";
import { READER_USER_AGENT } from "./reader";

/**
 * What a site says about itself to readers: its robots.txt and its
 * sitemaps, read as the Web pages kit reads them (`web-source.ts` of
 * `@nightshift/flows`), for the quick look at a link.
 */

/** The most sitemap files one look reads, sitemap indexes included. */
const MAX_SITEMAPS = 5;

const MAX_BYTES = 5 * 1024 * 1024;

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

/** The site's robots.txt. None, or one that does not load: nothing blocked, no sitemap named. */
export async function readRobots(
	origin: string,
	rules: AddressRules,
	signal: AbortSignal,
): Promise<Robots> {
	const found = await text(`${origin}/robots.txt`, rules, signal).catch(
		() => null,
	);
	return found === null
		? { blocked: [], sitemaps: [] }
		: parseRobots(origin, found);
}

/**
 * The pages the sitemaps list, cleaned and once each: the sitemaps
 * robots.txt names, else `<origin>/sitemap.xml`, one level of sitemap
 * index, at most `MAX_SITEMAPS` files.
 */
export async function sitemapPages(
	origin: string,
	robots: Robots,
	rules: AddressRules,
	signal: AbortSignal,
): Promise<string[]> {
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
		const locs = [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((match) =>
			(match[1] ?? "").replace(/&amp;/g, "&"),
		);
		if (/<sitemapindex/.test(xml)) todo.push(...locs);
		else for (const loc of locs) pages.add(cleanAddress(loc));
	}
	return [...pages];
}
