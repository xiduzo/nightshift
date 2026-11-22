import type { Seen } from "./page-read";
import { cleanAddress } from "./site";

/**
 * The quick look at a link a person tells (ADR 39), before anything is
 * saved: what it is, its title, and for a page how many pages share its
 * folder. What it is comes from the answer (its status, its content type,
 * `og:video`), never from a list of sites. These are its rules and its
 * words. The use case `lookAtLinks` does the requests.
 */

/** How long the look at one link may take. */
export const LOOK_MS = 8_000;

/** How long a look is kept: a person who pastes the same link again waits for nothing. */
const KEEP_MS = 5 * 60_000;

const MAX_KEPT = 200;

/** The most pages a reader's own map is asked for. */
export const MAP_LIMIT = 500;

/** How many links one look takes at once. */
export const LOOKS_AT_ONCE = 4;

/** The last part of a path that starts a section, not one article. */
const STARTS =
	/^(index|overview|introduction|intro|getting-started|start|home|readme|contents|toc)(\.html?)?$/i;

/** What a look says, in a person's words. */
export const LOOK_WORDS = {
	notAnAddress: "This is not a web address.",
	notWeb: "The address must start with http:// or https://.",
	robots: "The site asks readers to stay away from this page.",
	noAnswer: "The page did not answer.",
	late: "The page did not answer in time.",
	media: "This is video or audio. An agent can get its transcript.",
} as const;

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

/** A look with nothing found yet. */
export const emptyLook = (url: string): Omit<LinkLook, "kind"> => ({
	url,
	title: null,
	section: null,
	feed: null,
	items: null,
	fileType: null,
	reason: null,
});

/** How many items a week a feed had over the last four weeks, from its dates. */
export function perWeek(dates: readonly number[], at: number): number | null {
	if (dates.length === 0) return null;
	const weeks = 4;
	const since = at - weeks * 7 * 24 * 60 * 60_000;
	const recent = dates.filter((date) => date >= since && date <= at).length;
	return Math.round((recent / weeks) * 10) / 10;
}

/** Whether the address starts its folder. */
export function startsFolder(url: string): boolean {
	const path = new URL(cleanAddress(url)).pathname;
	if (path === "" || path.endsWith("/")) return true;
	return STARTS.test(path.split("/").at(-1) ?? "");
}

/** The pages under `folder`, once each. */
export const pagesUnder = (folder: string, pages: readonly string[]) =>
	new Set(pages.map(cleanAddress).filter((page) => page.startsWith(folder)))
		.size;

/** What a look says of a page a reader could not read. */
export function notReadLook(
	url: string,
	seen: Extract<Seen, { status: string }>,
): LinkLook {
	const kind = seen.status === "failed" ? "failed" : seen.status;
	return { ...emptyLook(url), kind, reason: seen.reason };
}

/** The looks of the last minutes, by project, reader and link. */
export type LookMemo = {
	/** The kept look, when it is younger than `KEEP_MS` at `at`. */
	get(key: string, at: number): LinkLook | null;
	/** Keeps a look, taken at `at`. The oldest goes past `MAX_KEPT`. */
	keep(key: string, at: number, look: LinkLook): void;
};

/** The key of a look in the memo. */
export const lookKey = (projectId: string, reader: string, url: string) =>
	`${projectId} ${reader} ${url}`;

export function createLookMemo(): LookMemo {
	const kept = new Map<string, { at: number; look: LinkLook }>();
	return {
		get(key, at) {
			const known = kept.get(key);
			return known && at - known.at < KEEP_MS ? known.look : null;
		},
		keep(key, at, look) {
			kept.delete(key);
			kept.set(key, { at, look });
			for (const old of kept.keys()) {
				if (kept.size <= MAX_KEPT) break;
				kept.delete(old);
			}
		},
	};
}
