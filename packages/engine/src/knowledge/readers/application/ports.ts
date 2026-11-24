import type { KeptRead, Looked, PageRead, ReadMark } from "../domain/page-read";
import type { Robots } from "../domain/site";

/**
 * The driven ports of knowledge/readers. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireReaders`.
 */

/**
 * The page reader port (ADR 39): one web page as Markdown, read by the
 * reader a person chose for the project. Night Shift's own reader works on
 * this computer (`local-page-reader.ts`). Jina Reader
 * (`jina-page-reader.ts`) and Firecrawl (`firecrawl-page-reader.ts`) are
 * services, at their cloud address or a self-hosted one. Any later reader
 * is one more adapter of this type.
 */
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

/** The page readers this computer can use: its own, and a service's. */
export type ReaderServices = {
	/** Night Shift's own reader, on this computer. */
	local: PageReader;
	/** One fetch of the page by Night Shift's own reader, and what it is: the quick look reads this. */
	look(
		url: string,
		options: { before?: ReadMark; signal?: AbortSignal; timeoutMs?: number },
	): Promise<Looked>;
	/** A service's reader at `address`, with its key when it has one. */
	service(
		kind: "jina" | "firecrawl",
		options: { address: string; key?: string },
	): PageReader;
};

/** What a site says about itself to readers. */
export type SiteFacts = {
	/** The site's robots.txt. None, or one that does not load: nothing blocked, no sitemap named. */
	robots(origin: string, signal: AbortSignal): Promise<Robots>;
	/** The pages the site's sitemaps list, cleaned and once each. */
	sitemapPages(
		origin: string,
		robots: Robots,
		signal: AbortSignal,
	): Promise<string[]>;
};

/**
 * What the last read of each page saw, per project and reader: the mark a
 * later read compares with, and the page's links. A cache of this
 * computer: it does not sync.
 */
export type ReadMarks = {
	get(projectId: string, reader: string, url: string): Promise<KeptRead | null>;
	set(
		projectId: string,
		reader: string,
		url: string,
		kept: { mark: ReadMark; links: readonly string[] },
	): Promise<void>;
	/** Writes what waits now. */
	flush(): Promise<void>;
};
