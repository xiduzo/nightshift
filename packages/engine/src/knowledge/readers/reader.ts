import { createHash } from "node:crypto";

/**
 * The page reader port (ADR 39): one web page as Markdown, read by the
 * reader a person chose for the project. Night Shift's own reader works on
 * this computer (`local.ts`). Jina Reader (`jina.ts`) and Firecrawl
 * (`firecrawl.ts`) are services, at their cloud address or a self-hosted
 * one. Any later reader is one more adapter of this type.
 */

/** What the last read of a page saw: what a later read compares with. */
export type ReadMark = {
	etag?: string;
	lastModified?: string;
	/** A hash of the Markdown the read gave. */
	fingerprint: string;
};

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

export type PageReader = {
	kind: "nightshift" | "jina" | "firecrawl";
	/** One page as Markdown. `before`: what the last read saw, for a check of change. */
	read(
		url: string,
		options: { before?: ReadMark; signal?: AbortSignal },
	): Promise<PageRead>;
	/** The addresses of a site, for a reader that finds them itself (Firecrawl). */
	map?(
		start: string,
		options: { limit: number; signal?: AbortSignal },
	): Promise<string[]>;
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
