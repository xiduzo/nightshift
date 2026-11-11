import type { JsonValue } from "@nightshift/flows";
import { iso, parseInstant } from "@nightshift/time";
import {
	type AnyFeed,
	type AtomFeed,
	DetectError,
	type JsonFeed,
	parseFeed,
	type RdfFeed,
	type RssFeed,
} from "feedsmith";
import { messageOf } from "../../context";
import { ConvertProblem } from "./problem";

/**
 * A feed with feedsmith: RSS, Atom, RDF or JSON Feed, read into one fixed
 * shape (`FEED_ITEM_KEYS` and `typedOutput` of `@nightshift/flows`),
 * so a later node reads `{{news.data.items}}` the same for each kind.
 * Every field is text, "" when the feed leaves it out. A date is ISO 8601
 * when it reads as one, else the feed's own text.
 */

type Item = {
	id: string;
	title: string;
	link: string;
	summary: string;
	content: string;
	published: string;
	updated: string;
	authors: string[];
	categories: string[];
};

type Feed = {
	format: AnyFeed["format"];
	title: string;
	link: string;
	description: string;
	items: Item[];
};

export function readFeed(text: string): JsonValue {
	let parsed: AnyFeed;
	try {
		parsed = parseFeed(text);
	} catch (error) {
		throw new ConvertProblem(
			error instanceof DetectError
				? "The value is not an RSS, Atom or JSON feed."
				: `The feed is not valid: ${messageOf(error)}`,
		);
	}
	return feedOf(parsed);
}

function feedOf(parsed: AnyFeed): Feed {
	switch (parsed.format) {
		case "rss":
			return rssFeed(parsed.feed);
		case "atom":
			return atomFeed(parsed.feed);
		case "rdf":
			return rdfFeed(parsed.feed);
		case "json":
			return jsonFeed(parsed.feed);
	}
}

function rssFeed(feed: RssFeed.Feed<string>): Feed {
	return {
		format: "rss",
		title: feed.title ?? "",
		link: feed.link ?? "",
		description: feed.description ?? "",
		items: (feed.items ?? []).map((item) =>
			itemOf({
				id: item.guid?.value,
				title: item.title,
				link: item.link,
				summary: item.description,
				content: item.content?.encoded,
				published: item.pubDate ?? item.dc?.dates?.[0],
				authors: [
					...(item.authors ?? []).map((author) => author.name ?? author.email),
					...(item.dc?.creators ?? []),
				],
				categories: (item.categories ?? []).map((category) => category.name),
			}),
		),
	};
}

function atomFeed(feed: AtomFeed.Feed<string>): Feed {
	return {
		format: "atom",
		title: feed.title?.value ?? "",
		link: atomLink(feed.links),
		description: feed.subtitle?.value ?? "",
		items: (feed.entries ?? []).map((entry) =>
			itemOf({
				id: entry.id,
				title: entry.title?.value,
				link: atomLink(entry.links),
				summary: entry.summary?.value,
				content: entry.content?.value,
				published: entry.published,
				updated: entry.updated,
				authors: (entry.authors ?? []).map((author) => author.name),
				categories: (entry.categories ?? []).map(
					(category) => category.label ?? category.term,
				),
			}),
		),
	};
}

function rdfFeed(feed: RdfFeed.Feed<string>): Feed {
	return {
		format: "rdf",
		title: feed.title ?? "",
		link: feed.link ?? "",
		description: feed.description ?? "",
		items: (feed.items ?? []).map((item) =>
			itemOf({
				id: item.rdf?.about,
				title: item.title,
				link: item.link,
				summary: item.description,
				content: item.content?.encoded,
				published: item.dc?.dates?.[0],
				authors: item.dc?.creators ?? [],
				categories: item.dc?.subjects ?? [],
			}),
		),
	};
}

function jsonFeed(feed: JsonFeed.Feed<string>): Feed {
	return {
		format: "json",
		title: feed.title ?? "",
		link: feed.home_page_url ?? "",
		description: feed.description ?? "",
		items: (feed.items ?? []).map((item) =>
			itemOf({
				id: item.id,
				title: item.title,
				link: item.url ?? item.external_url,
				summary: item.summary,
				content: item.content_html ?? item.content_text,
				published: item.date_published,
				updated: item.date_modified,
				authors: (item.authors ?? []).map((author) => author.name),
				categories: item.tags ?? [],
			}),
		),
	};
}

/** What a feed kind gives for one item, before the fixed shape. */
type ItemParts = {
	id?: string | undefined;
	title?: string | undefined;
	link?: string | undefined;
	summary?: string | undefined;
	content?: string | undefined;
	published?: string | undefined;
	updated?: string | undefined;
	authors: readonly (string | undefined)[];
	categories: readonly (string | undefined)[];
};

/** One item in the fixed shape. `id` falls back to the link, then the title. */
function itemOf(parts: ItemParts): Item {
	const title = parts.title ?? "";
	const link = parts.link ?? "";
	return {
		id: parts.id || link || title,
		title,
		link,
		summary: parts.summary ?? "",
		content: parts.content ?? "",
		published: isoDate(parts.published),
		updated: isoDate(parts.updated),
		authors: present(parts.authors),
		categories: present(parts.categories),
	};
}

/** The link of an Atom feed or entry: its `alternate` link, else its first. */
function atomLink(links: readonly AtomFeed.Link<string>[] | undefined): string {
	const alternate = links?.find(
		(link) => link.rel === undefined || link.rel === "alternate",
	);
	return alternate?.href ?? links?.[0]?.href ?? "";
}

/** A date as ISO 8601 when it reads as one, else as the feed wrote it. */
function isoDate(text: string | undefined): string {
	if (text === undefined || text.trim() === "") return "";
	const at = parseInstant(text);
	return Number.isNaN(at) ? text : iso(at);
}

function present(values: readonly (string | undefined)[]): string[] {
	return values.filter(
		(value): value is string => value !== undefined && value !== "",
	);
}
