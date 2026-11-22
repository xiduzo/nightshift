import {
	emptyLook,
	type LinkLook,
	LOOK_MS,
	LOOK_WORDS,
	LOOKS_AT_ONCE,
	type LookMemo,
	lookKey,
	MAP_LIMIT,
	notReadLook,
	pagesUnder,
	perWeek,
	startsFolder,
} from "../domain/link-look";
import type { Seen } from "../domain/page-read";
import { type ReaderSecret, readerOf } from "../domain/reader-choice";
import { cleanAddress, folderOf, type Robots } from "../domain/site";
import type {
	PageReader,
	ReaderServices,
	ReaderSettings,
	SiteFacts,
} from "./ports";

export type LookAtLinksPorts = {
	settings: Pick<ReaderSettings, "setting">;
	services: ReaderServices;
	sites: SiteFacts;
	/** The looks of the last minutes (`createLookMemo`). */
	memo: LookMemo;
	/** A secret of this computer outside a run: the key of a service reader. */
	secret?: ReaderSecret;
	now: () => number;
};

/** The project, and the links a person told, in their order. */
export type LookAtLinks = { projectId: string; urls: readonly string[] };

/**
 * The quick look at each link, in their order, with the project's reader
 * (ADR 39), before anything is saved. One cheap pass a link: one request
 * for the page, the site's robots.txt and its sitemaps, within `LOOK_MS`.
 * `LOOKS_AT_ONCE` links at a time.
 *
 * Night Shift's own reader takes the page. When it cannot read it and the
 * project reads with a service, the service tries: that reader is the one
 * a sync of the page would use.
 */
export const lookAtLinks =
	(ports: LookAtLinksPorts) =>
	async ({ projectId, urls }: LookAtLinks): Promise<LinkLook[]> => {
		const reader = await readerOf(
			await ports.settings.setting(projectId),
			ports.secret,
			ports.services,
		);
		const results: LinkLook[] = new Array(urls.length);
		let next = 0;
		const worker = async () => {
			while (next < urls.length) {
				const index = next++;
				results[index] = await look(
					ports,
					projectId,
					urls[index] as string,
					reader,
				);
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(LOOKS_AT_ONCE, urls.length) }, worker),
		);
		return results;
	};

/** The look at one link: kept a few minutes, and never longer than `LOOK_MS`. */
async function look(
	ports: LookAtLinksPorts,
	projectId: string,
	url: string,
	reader: PageReader,
): Promise<LinkLook> {
	const key = lookKey(projectId, reader.kind, url);
	const at = ports.now();
	const known = ports.memo.get(key, at);
	if (known) return known;
	let address: URL;
	try {
		address = new URL(url);
	} catch {
		return {
			...emptyLook(url),
			kind: "failed",
			reason: LOOK_WORDS.notAnAddress,
		};
	}
	if (address.protocol !== "http:" && address.protocol !== "https:") {
		return { ...emptyLook(url), kind: "failed", reason: LOOK_WORDS.notWeb };
	}
	const signal = AbortSignal.timeout(LOOK_MS);
	let result: LinkLook;
	try {
		result = { ...(await lookOnce(ports, address.href, reader, signal)), url };
	} catch {
		result = { ...emptyLook(url), kind: "failed", reason: LOOK_WORDS.late };
	}
	// A look cut short is not kept: the next look tries again.
	if (signal.aborted || result.kind === "failed") return result;
	ports.memo.keep(key, at, result);
	return result;
}

async function lookOnce(
	ports: LookAtLinksPorts,
	url: string,
	reader: PageReader,
	signal: AbortSignal,
): Promise<LinkLook> {
	const origin = new URL(url).origin;
	const robotsRead = ports.sites.robots(origin, signal);
	const looked = await ports.services.look(url, {
		signal,
		timeoutMs: LOOK_MS,
	});
	const robots = await robotsRead;
	if (robots.blocked.some((prefix) => cleanAddress(url).startsWith(prefix))) {
		return { ...emptyLook(url), kind: "blocked", reason: LOOK_WORDS.robots };
	}
	let seen: Seen | null = looked.seen;
	if (seen === null) {
		return { ...emptyLook(url), kind: "failed", reason: LOOK_WORDS.noAnswer };
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
	if ("status" in seen) return notReadLook(url, seen);
	switch (seen.kind) {
		case "feed":
			return {
				...emptyLook(url),
				kind: "feed",
				title: seen.title,
				items: { count: seen.items, perWeek: perWeek(seen.dates, ports.now()) },
			};
		case "file":
			return {
				...emptyLook(url),
				kind: "file",
				title: seen.title,
				fileType: seen.type,
			};
		case "html": {
			if (seen.media) {
				return {
					...emptyLook(url),
					kind: "media",
					title: seen.title,
					reason: LOOK_WORDS.media,
				};
			}
			const facts = await section(
				ports,
				looked.url,
				reader,
				seen.links,
				robots,
				signal,
			);
			return {
				...emptyLook(url),
				kind: facts?.starts ? "section" : "page",
				title: seen.title,
				section: facts,
				feed: seen.feeds[0] ?? null,
			};
		}
	}
}

/** The pages that share the folder of `url`: by the sitemap, else the reader's own map, else the page's links. */
async function section(
	ports: LookAtLinksPorts,
	url: string,
	reader: PageReader,
	links: readonly string[],
	robots: Robots,
	signal: AbortSignal,
): Promise<LinkLook["section"]> {
	const folder = folderOf(url);
	const starts = startsFolder(url);
	const origin = new URL(url).origin;
	const fromSitemap = pagesUnder(
		folder,
		await ports.sites.sitemapPages(origin, robots, signal).catch(() => []),
	);
	if (fromSitemap > 1) {
		return { folder, pages: fromSitemap, from: "sitemap", starts };
	}
	if (reader.map) {
		const mapped = await reader
			.map(folder, { limit: MAP_LIMIT, signal })
			.catch(() => []);
		const pages = pagesUnder(folder, mapped);
		if (pages > 1) return { folder, pages, from: "map", starts };
	}
	const linked = pagesUnder(folder, [cleanAddress(url), ...links]);
	return linked > 1 ? { folder, pages: linked, from: "links", starts } : null;
}
