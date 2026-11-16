import { now } from "@nightshift/time";
import type { AddressRules } from "../../web-access";
import type { LocalReader, Seen } from "./local";
import type { PageReader } from "./reader";
import {
	cleanAddress,
	folderOf,
	type Robots,
	readRobots,
	sitemapPages,
} from "./site";

/**
 * The quick look at a link a person tells (ADR 39), before anything is
 * saved: what it is, its title, and for a page how many pages share its
 * folder. One cheap pass: one request for the page, the site's robots.txt
 * and its sitemaps, within `LOOK_MS`. What it is comes from the answer
 * (its status, its content type, `og:video`), never from a list of sites.
 *
 * Night Shift's own reader takes the page. When it cannot read it and the
 * project reads with a service, the service tries: that reader is the one
 * a sync of the page would use.
 */

/** How long the look at one link may take. */
const LOOK_MS = 8_000;

/** How long a look is kept: a person who pastes the same link again waits for nothing. */
const KEEP_MS = 5 * 60_000;

const MAX_KEPT = 200;

/** The most pages a reader's own map is asked for. */
const MAP_LIMIT = 500;

/** The last part of a path that starts a section, not one article. */
const STARTS =
	/^(index|overview|introduction|intro|getting-started|start|home|readme|contents|toc)(\.html?)?$/i;

export type LinkLook = {
	url: string;
	/**
	 * `page`: one page. `section`: the page starts a folder of more pages.
	 * `feed`: an RSS, Atom or JSON feed. `file`: a PDF, Word or text file.
	 * `signin`: the page asks to sign in. `media`: video or audio. `gone`:
	 * nothing there. `needs-browser`: the text shows only in a browser.
	 * `blocked`: the site keeps readers out. `failed`: the look did not get an
	 * answer.
	 */
	kind:
		| "page"
		| "section"
		| "feed"
		| "file"
		| "signin"
		| "media"
		| "gone"
		| "needs-browser"
		| "blocked"
		| "failed";
	/** Null when the look did not find one. */
	title: string | null;
	/** For a page or a section: the pages that share its folder. Null: no other page found. */
	section: {
		folder: string;
		pages: number;
		/** Where the count comes from: the sitemap, the reader's own map, or the page's links. */
		from: "sitemap" | "map" | "links";
		/** The address starts the folder (its index, or the folder itself), not one article in it. */
		starts: boolean;
	} | null;
	/** For a page: the feed it names. */
	feed: string | null;
	/** For a feed: how many items it has, and how many it had a week over the last four weeks. */
	items: { count: number; perWeek: number | null } | null;
	/** For a file: what it is. */
	fileType: "pdf" | "word" | "text" | null;
	/** Why it cannot be read as it is, in a person's words. Null for a page, section, feed or file. */
	reason: string | null;
};

type LookDeps = {
	local: LocalReader;
	rules: () => AddressRules;
};

const empty = (url: string): Omit<LinkLook, "kind"> => ({
	url,
	title: null,
	section: null,
	feed: null,
	items: null,
	fileType: null,
	reason: null,
});

/** How many items a week a feed had over the last four weeks, from its dates. */
function perWeek(dates: readonly number[], at: number): number | null {
	if (dates.length === 0) return null;
	const weeks = 4;
	const since = at - weeks * 7 * 24 * 60 * 60_000;
	const recent = dates.filter((date) => date >= since && date <= at).length;
	return Math.round((recent / weeks) * 10) / 10;
}

/** Whether the address starts its folder. */
function startsFolder(url: string): boolean {
	const path = new URL(cleanAddress(url)).pathname;
	if (path === "" || path.endsWith("/")) return true;
	return STARTS.test(path.split("/").at(-1) ?? "");
}

/** The pages under `folder`, once each. */
const under = (folder: string, pages: readonly string[]) =>
	new Set(pages.map(cleanAddress).filter((page) => page.startsWith(folder)))
		.size;

/** What a look says of a page a reader could not read. */
function notRead(
	url: string,
	seen: Extract<Seen, { status: string }>,
): LinkLook {
	const kind = seen.status === "failed" ? "failed" : seen.status;
	return { ...empty(url), kind, reason: seen.reason };
}

export function createLook(deps: LookDeps) {
	const kept = new Map<string, { at: number; look: LinkLook }>();

	async function section(
		url: string,
		reader: PageReader,
		links: readonly string[],
		robots: Robots,
		signal: AbortSignal,
	): Promise<LinkLook["section"]> {
		const folder = folderOf(url);
		const starts = startsFolder(url);
		const origin = new URL(url).origin;
		const fromSitemap = under(
			folder,
			await sitemapPages(origin, robots, deps.rules(), signal).catch(() => []),
		);
		if (fromSitemap > 1) {
			return { folder, pages: fromSitemap, from: "sitemap", starts };
		}
		if (reader.map) {
			const mapped = await reader
				.map(folder, { limit: MAP_LIMIT, signal })
				.catch(() => []);
			const pages = under(folder, mapped);
			if (pages > 1) return { folder, pages, from: "map", starts };
		}
		const linked = under(folder, [cleanAddress(url), ...links]);
		return linked > 1 ? { folder, pages: linked, from: "links", starts } : null;
	}

	async function lookOnce(
		url: string,
		reader: PageReader,
		signal: AbortSignal,
	): Promise<LinkLook> {
		const origin = new URL(url).origin;
		const robotsRead = readRobots(origin, deps.rules(), signal);
		const looked = await deps.local.look(url, { signal, timeoutMs: LOOK_MS });
		const robots = await robotsRead;
		if (robots.blocked.some((prefix) => cleanAddress(url).startsWith(prefix))) {
			return {
				...empty(url),
				kind: "blocked",
				reason: "The site asks readers to stay away from this page.",
			};
		}
		let seen = looked.seen;
		if (seen === null) {
			return {
				...empty(url),
				kind: "failed",
				reason: "The page did not answer.",
			};
		}
		if (
			"status" in seen &&
			reader.kind !== "nightshift" &&
			(seen.status === "blocked" ||
				seen.status === "needs-browser" ||
				seen.status === "failed")
		) {
			// The project's reader reads what this computer cannot: a page that needs
			// a browser, or a site that keeps plain readers out.
			const read = await reader.read(url, { signal });
			if (read.status === "read") {
				seen = {
					kind: "html",
					title: read.title,
					markdown: read.markdown,
					links: read.links,
					feeds: [],
					media: false,
					words: 0,
				};
			} else if (read.status !== "unchanged") {
				seen = read;
			}
		}
		if ("status" in seen) return notRead(url, seen);
		switch (seen.kind) {
			case "feed":
				return {
					...empty(url),
					kind: "feed",
					title: seen.title,
					items: { count: seen.items, perWeek: perWeek(seen.dates, now()) },
				};
			case "file":
				return {
					...empty(url),
					kind: "file",
					title: seen.title,
					fileType: seen.type,
				};
			case "html": {
				if (seen.media) {
					return {
						...empty(url),
						kind: "media",
						title: seen.title,
						reason: "This is video or audio. An agent can get its transcript.",
					};
				}
				const facts = await section(
					looked.url,
					reader,
					seen.links,
					robots,
					signal,
				);
				return {
					...empty(url),
					kind: facts?.starts ? "section" : "page",
					title: seen.title,
					section: facts,
					feed: seen.feeds[0] ?? null,
				};
			}
		}
	}

	/** The look at one link: kept a few minutes, and never longer than `LOOK_MS`. */
	async function look(
		projectId: string,
		url: string,
		reader: PageReader,
	): Promise<LinkLook> {
		const key = `${projectId} ${reader.kind} ${url}`;
		const at = now();
		const known = kept.get(key);
		if (known && at - known.at < KEEP_MS) return known.look;
		let address: URL;
		try {
			address = new URL(url);
		} catch {
			return {
				...empty(url),
				kind: "failed",
				reason: "This is not a web address.",
			};
		}
		if (address.protocol !== "http:" && address.protocol !== "https:") {
			return {
				...empty(url),
				kind: "failed",
				reason: "The address must start with http:// or https://.",
			};
		}
		const signal = AbortSignal.timeout(LOOK_MS);
		let result: LinkLook;
		try {
			result = { ...(await lookOnce(address.href, reader, signal)), url };
		} catch {
			result = {
				...empty(url),
				kind: "failed",
				reason: "The page did not answer in time.",
			};
		}
		// A look cut short is not kept: the next look tries again.
		if (signal.aborted || result.kind === "failed") return result;
		kept.delete(key);
		kept.set(key, { at, look: result });
		for (const old of kept.keys()) {
			if (kept.size <= MAX_KEPT) break;
			kept.delete(old);
		}
		return result;
	}

	return { look };
}
