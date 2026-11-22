import { iso, parseInstant } from "@nightshift/time";
import { type AnyFeed, type AtomFeed, parseFeed } from "feedsmith";
import { parseHTML } from "linkedom";

/**
 * An RSS, Atom, RDF or JSON feed as a page of the knowledge: its newest
 * items, each with its title, date, link and summary, as Markdown. The
 * Feeds kit reads a feed for a flow. This is the page an agent reads.
 */

/** How many items the page keeps, newest first. */
const FEED_ITEMS = 30;

/** How much of an item's summary the page keeps. */
const SUMMARY_CHARS = 600;

type FeedItem = {
	title: string;
	link: string;
	summary: string;
	/** Epoch ms, or null when the feed gives no date that reads as one. */
	at: number | null;
};

export type FeedPage = {
	title: string;
	markdown: string;
	links: string[];
	/** Every item's date, newest first: how often the feed has news. */
	dates: number[];
	items: number;
};

function atOf(text: string | undefined): number | null {
	if (!text?.trim()) return null;
	const at = parseInstant(text);
	return Number.isNaN(at) ? null : at;
}

function atomLink(links: readonly AtomFeed.Link<string>[] | undefined): string {
	const alternate = links?.find(
		(link) => link.rel === undefined || link.rel === "alternate",
	);
	return alternate?.href ?? links?.[0]?.href ?? "";
}

/** The feed's title and items, whatever its kind. */
function partsOf(parsed: AnyFeed): { title: string; items: FeedItem[] } {
	switch (parsed.format) {
		case "rss":
			return {
				title: parsed.feed.title ?? "",
				items: (parsed.feed.items ?? []).map((item) => ({
					title: item.title ?? "",
					link: item.link ?? "",
					summary: item.description ?? "",
					at: atOf(item.pubDate ?? item.dc?.dates?.[0]),
				})),
			};
		case "atom":
			return {
				title: parsed.feed.title?.value ?? "",
				items: (parsed.feed.entries ?? []).map((entry) => ({
					title: entry.title?.value ?? "",
					link: atomLink(entry.links),
					summary: entry.summary?.value ?? entry.content?.value ?? "",
					at: atOf(entry.published ?? entry.updated),
				})),
			};
		case "rdf":
			return {
				title: parsed.feed.title ?? "",
				items: (parsed.feed.items ?? []).map((item) => ({
					title: item.title ?? "",
					link: item.link ?? "",
					summary: item.description ?? "",
					at: atOf(item.dc?.dates?.[0]),
				})),
			};
		case "json":
			return {
				title: parsed.feed.title ?? "",
				items: (parsed.feed.items ?? []).map((item) => ({
					title: item.title ?? "",
					link: item.url ?? item.external_url ?? "",
					summary: item.summary ?? item.content_text ?? item.content_html ?? "",
					at: atOf(item.date_published ?? item.date_modified),
				})),
			};
	}
}

/** The text of a summary that may hold HTML, on one line, cut short. */
function plainSummary(summary: string): string {
	const text = summary.includes("<")
		? (parseHTML(`<html><body>${summary}</body></html>`).document.body
				?.textContent ?? "")
		: summary;
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > SUMMARY_CHARS
		? `${line.slice(0, SUMMARY_CHARS).trimEnd()}…`
		: line;
}

/** The feed as a page, or null when the text is no feed. */
export function feedPage(text: string, fallbackTitle: string): FeedPage | null {
	let parsed: AnyFeed;
	try {
		parsed = parseFeed(text);
	} catch {
		return null;
	}
	const { title: own, items } = partsOf(parsed);
	const title = own.trim() || fallbackTitle;
	const newest = [...items].sort(
		(a, b) =>
			(b.at ?? Number.NEGATIVE_INFINITY) - (a.at ?? Number.NEGATIVE_INFINITY),
	);
	const kept = newest.slice(0, FEED_ITEMS);
	const sections = kept.map((item) => {
		const heading = item.title.trim() || item.link || "Untitled";
		const lines = [`## ${item.link ? `[${heading}](${item.link})` : heading}`];
		if (item.at !== null) lines.push(`_${iso(item.at).slice(0, 10)}_`);
		const summary = plainSummary(item.summary);
		if (summary) lines.push(summary);
		return lines.join("\n\n");
	});
	return {
		title,
		markdown: [`# ${title}`, ...sections].join("\n\n"),
		links: kept.flatMap((item) => (item.link ? [item.link] : [])),
		dates: newest.flatMap((item) => (item.at === null ? [] : [item.at])),
		items: items.length,
	};
}
