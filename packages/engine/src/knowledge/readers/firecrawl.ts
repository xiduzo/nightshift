import { PAGE_READER_DEFAULTS } from "@nightshift/flows";
import type { AddressRules } from "../../web-access";
import { type Fetched, fetchGuarded } from "./fetch";
import { nameOfAddress } from "./local";
import {
	absoluteLink,
	linksOfMarkdown,
	type PageReader,
	READER_USER_AGENT,
	readOrUnchanged,
} from "./reader";

/**
 * Firecrawl as a page reader (ADR 39), on its v2 API, the current one:
 * `POST <address>/v2/scrape` with the formats `markdown` and `links`, and
 * `POST <address>/v2/map` for the addresses of a site. At
 * `https://api.firecrawl.dev` it needs a key, as a Bearer token. A
 * self-hosted Firecrawl may need none.
 *
 * A scrape answers `{ success, data: { markdown, links, metadata } }`. The
 * metadata has the page's own `statusCode`, `title` and `contentType`, so
 * a page that is gone or asks to sign in reads as such.
 */

const READ_TIMEOUT_MS = 120_000;

/** How long Firecrawl itself may take for one page, in ms (its own limit is 300 000). */
const SCRAPE_TIMEOUT_MS = 90_000;

const MAX_ANSWER = 20 * 1024 * 1024;

type ScrapeAnswer = {
	success?: boolean;
	error?: string;
	data?: {
		markdown?: string;
		links?: (string | { url?: string })[];
		metadata?: {
			title?: string | string[];
			statusCode?: number;
			contentType?: string;
			url?: string;
			sourceURL?: string;
			error?: string | null;
		};
	};
};

type MapAnswer = {
	success?: boolean;
	links?: (string | { url?: string })[];
};

/** Why Firecrawl did not answer with a page, in a person's words. */
function serviceProblem(fetched: Fetched): string | null {
	if (fetched.kind !== "response") {
		return `Firecrawl could not be reached. ${fetched.message}`;
	}
	switch (fetched.status) {
		case 200:
			return null;
		case 401:
		case 403:
			return "Firecrawl did not accept its key. Check the secret it reads.";
		case 402:
			return "Firecrawl has no credit left for this key.";
		case 429:
			return "Firecrawl asks to slow down. Try again later.";
		default:
			return `Firecrawl answered with an error (${fetched.status}).`;
	}
}

function json<T>(fetched: Fetched): T | null {
	if (fetched.kind !== "response") return null;
	try {
		return JSON.parse(new TextDecoder().decode(fetched.body)) as T;
	} catch {
		return null;
	}
}

const urlsOf = (links: readonly (string | { url?: string })[] | undefined) =>
	(links ?? []).flatMap((link) => {
		const raw = typeof link === "string" ? link : link.url;
		const url = raw ? absoluteLink(raw) : null;
		return url === null ? [] : [url];
	});

export function firecrawlReader(deps: {
	address: string;
	key?: string;
	rules: () => AddressRules;
}): PageReader {
	const address = deps.address.replace(/\/+$/, "");
	const cloud =
		address === PAGE_READER_DEFAULTS.firecrawl.address.replace(/\/+$/, "");
	const noKey =
		cloud && !deps.key
			? "Firecrawl needs a key. Save it as a secret, and choose that secret for the reader."
			: null;

	function post(path: string, body: unknown, signal?: AbortSignal) {
		return fetchGuarded(`${address}${path}`, {
			method: "POST",
			headers: {
				"user-agent": READER_USER_AGENT,
				"content-type": "application/json",
				...(deps.key ? { authorization: `Bearer ${deps.key}` } : {}),
			},
			body: JSON.stringify(body),
			...(signal ? { signal } : {}),
			timeoutMs: READ_TIMEOUT_MS,
			maxBytes: MAX_ANSWER,
			rules: deps.rules(),
		});
	}

	return {
		kind: "firecrawl",
		async read(url, { before, signal }) {
			if (noKey) return { status: "failed", reason: noKey };
			const fetched = await post(
				"/v2/scrape",
				{
					url,
					formats: ["markdown", "links"],
					onlyMainContent: true,
					timeout: SCRAPE_TIMEOUT_MS,
				},
				signal,
			);
			const problem = serviceProblem(fetched);
			const answer = json<ScrapeAnswer>(fetched);
			if (problem !== null) {
				// A page Firecrawl could not take says why in `error`.
				const said = answer?.error ? ` ${answer.error}` : "";
				return { status: "failed", reason: `${problem}${said}` };
			}
			if (!answer?.success || !answer.data) {
				return {
					status: "failed",
					reason: `Firecrawl could not read the page.${answer?.error ? ` ${answer.error}` : ""}`,
				};
			}
			const { markdown = "", links, metadata = {} } = answer.data;
			const code = metadata.statusCode ?? 200;
			if (code === 404 || code === 410) {
				return { status: "gone", reason: "The page is not there any more." };
			}
			if (code === 401) {
				return {
					status: "signin",
					reason: "The page asks you to sign in first.",
				};
			}
			if (code === 403 || code === 451) {
				return {
					status: "blocked",
					reason: "The site does not let readers in.",
				};
			}
			if (code >= 400) {
				return {
					status: "failed",
					reason: `The site answered with an error (${code}).`,
				};
			}
			const text = markdown.trim();
			if (text === "") {
				return {
					status: "needs-browser",
					reason: "The page has no text to read.",
				};
			}
			const title = Array.isArray(metadata.title)
				? metadata.title[0]
				: metadata.title;
			const source = metadata.url ?? metadata.sourceURL ?? url;
			const own = urlsOf(links);
			return readOrUnchanged(
				{
					title: title?.trim() || nameOfAddress(url),
					markdown: text,
					links: own.length > 0 ? own : linksOfMarkdown(text, source),
					contentType:
						metadata.contentType?.split(";")[0]?.trim() ?? "text/html",
				},
				before,
			);
		},
		async map(start, { limit, signal }) {
			if (noKey) return [];
			const fetched = await post("/v2/map", { url: start, limit }, signal);
			if (serviceProblem(fetched) !== null) return [];
			const answer = json<MapAnswer>(fetched);
			return answer?.success ? urlsOf(answer.links).slice(0, limit) : [];
		},
	};
}
