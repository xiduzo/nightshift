import { createHash } from "node:crypto";

/**
 * What a read of a web page gives (ADR 39), whichever reader read it: the
 * page as Markdown, that it did not change, or why it was not read. The
 * port is `PageReader` (`application/ports.ts`).
 */

/** What the last read of a page saw: what a later read compares with. */
export type ReadMark = {
	etag?: string;
	lastModified?: string;
	/** A hash of the Markdown the read gave. */
	fingerprint: string;
};

/** What this computer keeps of the last read of a page: its mark, and its links, so a crawl that finds it unchanged still follows them. */
export type KeptRead = { mark: ReadMark; links: string[] };

/** Why a page was not read, in the words a person sees. */
export type NotRead = {
	status: "signin" | "gone" | "blocked" | "needs-browser" | "failed";
	reason: string;
};

/** One read of a page. */
export type PageRead =
	| {
			status: "read";
			title: string;
			markdown: string;
			/** Every web address the page links to, absolute, without a `#fragment`. */
			links: string[];
			mark: ReadMark;
			/** What the page is, as its server says it: `text/html`, `application/pdf`. */
			contentType: string;
	  }
	| { status: "unchanged"; mark: ReadMark }
	| NotRead;

/** What the page is, as Night Shift's own reader saw it: one fetch, looked at once. */
export type Seen =
	| {
			kind: "html";
			title: string;
			markdown: string;
			links: string[];
			/** The feeds the page names (`<link rel="alternate">`). */
			feeds: string[];
			/** The page is a video or audio player (`og:video`, `og:audio`, `og:type`). */
			media: boolean;
			words: number;
	  }
	| {
			kind: "feed";
			title: string;
			markdown: string;
			links: string[];
			dates: number[];
			items: number;
	  }
	| {
			kind: "file";
			type: "pdf" | "word" | "text";
			title: string;
			markdown: string;
	  }
	| NotRead;

/** A fetch, as what it is and the headers that mark it. */
export type Looked = {
	/** Null: the server said the page did not change since `before` (304). */
	seen: Seen | null;
	contentType: string;
	/** Where the page came from, after redirects. */
	url: string;
	etag?: string;
	lastModified?: string;
};

/** The User-Agent of every request a reader of this computer sends: it names the product, never the person. */
export const READER_USER_AGENT =
	"NightShift-knowledge/1 (+https://github.com/xiduzo/nightshift)";

/** The fingerprint of a read: its title and Markdown, so a page that only moved its bytes around reads as unchanged. */
export function fingerprintOf(title: string, markdown: string): string {
	return createHash("sha256")
		.update(title)
		.update("\n")
		.update(markdown)
		.digest("hex");
}

/**
 * A read as a reader of a service gives it: `unchanged` when its Markdown
 * is what the last read saw. A service reads the whole page each time, so
 * the fingerprint is all it can compare.
 */
export function readOrUnchanged(
	read: Omit<Extract<PageRead, { status: "read" }>, "mark" | "status">,
	before: ReadMark | undefined,
): PageRead {
	const mark = { fingerprint: fingerprintOf(read.title, read.markdown) };
	if (before?.fingerprint === mark.fingerprint) {
		return { status: "unchanged", mark };
	}
	return { status: "read", ...read, mark };
}

/** The web addresses a Markdown text links to, absolute and once each, without a `#fragment`. */
export function linksOfMarkdown(markdown: string, base?: string): string[] {
	const found = new Set<string>();
	for (const match of markdown.matchAll(/\]\(\s*<?([^)\s>]+)>?/g)) {
		const link = absoluteLink(match[1] ?? "", base);
		if (link !== null) found.add(link);
	}
	return [...found];
}

/** An address as a link gives it, made absolute against `base`: null when it is no web address. */
export function absoluteLink(href: string, base?: string): string | null {
	try {
		const url = base === undefined ? new URL(href) : new URL(href, base);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		url.hash = "";
		return url.href;
	} catch {
		return null;
	}
}

/** The message of an error, for a reason a person reads. */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The last part of an address's path, for a title when the page gives none. */
export function nameOfAddress(address: string): string {
	try {
		const url = new URL(address);
		const last = url.pathname.split("/").filter(Boolean).at(-1);
		return last ? decodeURIComponent(last) : url.hostname;
	} catch {
		return address;
	}
}
