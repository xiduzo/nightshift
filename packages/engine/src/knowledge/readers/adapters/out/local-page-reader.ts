import { messageOf } from "@nightshift/refusal";
import { parseHTML } from "linkedom";
import {
	LOCAL_ONLY_BYTES,
	loadDocumentContent,
	textOf,
} from "../../../../file-loaders";
import type { AddressRules } from "../../../../web-access";
import type { PageReader } from "../../application/ports";
import {
	absoluteLink,
	fingerprintOf,
	type Looked,
	nameOfAddress,
	READER_USER_AGENT,
	type ReadMark,
	type Seen,
} from "../../domain/page-read";
import { feedPage } from "./feed-page";
import { type Fetched, fetchGuarded } from "./fetch-guarded";

/**
 * Night Shift's own page reader: it reads on this computer, with no account
 * and no service in between (ADR 39). Bun's `fetch` takes the page, by the
 * address rule of every request of this computer. An HTML page goes through
 * linkedom (a DOM without a browser) and defuddle (the main content, as
 * Markdown). A PDF or Word file goes through the knowledge's own loaders
 * (ADR 16). A feed becomes a page of its newest items. No headless browser:
 * a page that shows its text only with JavaScript is `needs-browser`.
 *
 * A read asks with the last read's `ETag` and `Last-Modified`, so a server
 * that keeps them answers 304 and nothing is read again. A server that
 * does not still sends the page: then the fingerprint of its Markdown tells
 * whether it changed.
 */

/** How long one read may take. */
const READ_TIMEOUT_MS = 60_000;

/** A page with fewer words than this, and scripts, shows its text only in a browser. */
const FEW_WORDS = 30;

/** A sign-in form on a page with fewer words than this is a sign-in wall. */
const SIGNIN_WORDS = 150;

/** An address a server sends a reader to when it must sign in first. */
const SIGNIN_ADDRESS =
	/^https?:\/\/(?:(?:login|signin|sso|auth|accounts?|id)\.[^/]+\/|[^/]+\/(?:.*\/)?(?:login|log-in|signin|sign-in|sso|oauth2?|authorize|auth)(?:[/?.#]|$))/i;

const ACCEPT =
	"text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/feed+json,application/xml;q=0.9,application/pdf,text/plain;q=0.8,*/*;q=0.5";

/** The media type of an answer, lower case, without its parameters. */
function mediaType(headers: Headers): string {
	return (
		(headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ??
		""
	);
}

function decode(body: Uint8Array, headers: Headers): string {
	const charset = /charset=([^;]+)/i
		.exec(headers.get("content-type") ?? "")?.[1]
		?.trim()
		.replace(/^["']|["']$/g, "");
	try {
		return new TextDecoder(
			(charset || "utf-8") as ConstructorParameters<typeof TextDecoder>[0],
		).decode(body);
	} catch {
		return new TextDecoder("utf-8").decode(body);
	}
}

const countWords = (text: string) =>
	text.split(/\s+/).filter((word) => /\w/.test(word)).length;

/** An HTML page: its main content as Markdown, its links, and the signs of what it is. */
async function seeHtml(html: string, url: string): Promise<Seen> {
	const { document } = parseHTML(html);
	const meta = (name: string) =>
		document
			.querySelector(`meta[property="${name}"], meta[name="${name}"]`)
			?.getAttribute("content") ?? "";
	const base = absoluteLink(
		document.querySelector("base[href]")?.getAttribute("href") ?? url,
		url,
	);
	const links = new Set<string>();
	for (const anchor of document.querySelectorAll("a[href]")) {
		const link = absoluteLink(anchor.getAttribute("href") ?? "", base ?? url);
		if (link !== null) links.add(link);
	}
	const feeds = [
		...document.querySelectorAll('link[rel~="alternate"][href]'),
	].flatMap((link) => {
		const type = (link.getAttribute("type") ?? "").toLowerCase();
		if (!/rss|atom|feed\+json/.test(type)) return [];
		const href = absoluteLink(link.getAttribute("href") ?? "", base ?? url);
		return href === null ? [] : [href];
	});
	const ogType = meta("og:type").toLowerCase();
	const media =
		meta("og:video") !== "" ||
		meta("og:video:url") !== "" ||
		meta("og:audio") !== "" ||
		ogType.startsWith("video") ||
		ogType.startsWith("music");
	const scripted =
		document.querySelectorAll("script[src]").length > 0 ||
		document.querySelector("noscript") !== null;
	const password = document.querySelector('input[type="password"]') !== null;
	const bodyWords = countWords(document.body?.textContent ?? "");
	const ownTitle = (document.querySelector("title")?.textContent ?? "").trim();
	if (password && bodyWords < SIGNIN_WORDS) {
		return { status: "signin", reason: "The page asks you to sign in first." };
	}
	const { Defuddle } = await import("defuddle/node");
	const result = await Defuddle(
		document as unknown as Parameters<typeof Defuddle>[0],
		url,
		{
			markdown: true,
			// Never ask a third party for what the page does not hold.
			useAsync: false,
		},
	);
	const markdown = result.content.trim();
	const words = countWords(markdown);
	if (words < FEW_WORDS && scripted && !media) {
		return {
			status: "needs-browser",
			reason: "The page shows its text only in a browser.",
		};
	}
	return {
		kind: "html",
		title: (result.title || ownTitle || nameOfAddress(url)).trim(),
		markdown,
		links: [...links],
		feeds,
		media,
		words,
	};
}

/** A PDF or Word file, by the knowledge's own loaders. */
async function seeDocument(
	body: Uint8Array,
	type: "pdf" | "word",
	url: string,
): Promise<Seen> {
	const docs = await loadDocumentContent(
		type === "pdf" ? "page.pdf" : "page.docx",
		body,
	);
	if (docs === null) {
		return { status: "failed", reason: "The file does not open." };
	}
	const markdown = textOf(docs);
	const title = docs[0]?.metadata.title ?? nameOfAddress(url);
	return { kind: "file", type, title, markdown };
}

/** What one answer is, as a page, a feed, a file or why it is none. */
async function see(
	fetched: Extract<Fetched, { kind: "response" }>,
): Promise<Seen> {
	const { status, headers, url, body, cut } = fetched;
	if (status === 401) {
		return { status: "signin", reason: "The page asks you to sign in first." };
	}
	if (status === 404 || status === 410) {
		return { status: "gone", reason: "The page is not there any more." };
	}
	if (fetched.hops.slice(1).some((hop) => SIGNIN_ADDRESS.test(hop))) {
		return {
			status: "signin",
			reason: "The page sends readers to a sign-in page.",
		};
	}
	if (status === 403 || status === 451) {
		const text = mediaType(headers).includes("html")
			? decode(body, headers)
			: "";
		if (/type=["']?password/i.test(text)) {
			return {
				status: "signin",
				reason: "The page asks you to sign in first.",
			};
		}
		return { status: "blocked", reason: "The site does not let readers in." };
	}
	if (status === 429) {
		return {
			status: "failed",
			reason: "The site asks readers to slow down. Try again later.",
		};
	}
	if (status < 200 || status >= 300) {
		return {
			status: "failed",
			reason: `The site answered with an error (${status}).`,
		};
	}
	const type = mediaType(headers);
	if (/^(audio|video)\//.test(type)) {
		return {
			status: "failed",
			reason: "This is audio or video, not text.",
		};
	}
	if (
		type === "application/pdf" ||
		type.endsWith("wordprocessingml.document")
	) {
		if (cut) {
			return {
				status: "failed",
				reason: `The file is larger than ${LOCAL_ONLY_BYTES / (1024 * 1024)} MB.`,
			};
		}
		return seeDocument(body, type === "application/pdf" ? "pdf" : "word", url);
	}
	const text = decode(body, headers);
	if (/rss|atom|feed\+json/.test(type) || /xml|json/.test(type)) {
		const feed = feedPage(text, nameOfAddress(url));
		if (feed) return { kind: "feed", ...feed };
		if (/rss|atom|feed\+json/.test(type)) {
			return { status: "failed", reason: "The feed is not valid." };
		}
	}
	if (type === "" || type.includes("html")) return seeHtml(text, url);
	if (type.startsWith("text/")) {
		const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
		return {
			kind: "file",
			type: "text",
			title: heading || nameOfAddress(url),
			markdown: text.trim(),
		};
	}
	return {
		status: "failed",
		reason: "Night Shift cannot read this kind of file.",
	};
}

export type LocalReader = PageReader & {
	/** One fetch of the page, and what it is: the quick look reads this. */
	look(
		url: string,
		options: { before?: ReadMark; signal?: AbortSignal; timeoutMs?: number },
	): Promise<Looked>;
};

/** Night Shift's own reader, on this computer. `rules`: where it may connect now. */
export function localReader(deps: {
	rules: () => AddressRules;
	timeoutMs?: number;
}): LocalReader {
	async function look(
		url: string,
		options: { before?: ReadMark; signal?: AbortSignal; timeoutMs?: number },
	): Promise<Looked> {
		const { before } = options;
		const fetched = await fetchGuarded(url, {
			headers: {
				"user-agent": READER_USER_AGENT,
				accept: ACCEPT,
				...(before?.etag ? { "if-none-match": before.etag } : {}),
				...(before?.lastModified
					? { "if-modified-since": before.lastModified }
					: {}),
			},
			...(options.signal ? { signal: options.signal } : {}),
			timeoutMs: options.timeoutMs ?? deps.timeoutMs ?? READ_TIMEOUT_MS,
			maxBytes: LOCAL_ONLY_BYTES,
			rules: deps.rules(),
		});
		if (fetched.kind !== "response") {
			return {
				seen: {
					status: fetched.kind === "refused" ? "blocked" : "failed",
					reason: fetched.message,
				},
				contentType: "",
				url,
			};
		}
		const etag = fetched.headers.get("etag") ?? undefined;
		const lastModified = fetched.headers.get("last-modified") ?? undefined;
		const marks = {
			...(etag ? { etag } : {}),
			...(lastModified ? { lastModified } : {}),
		};
		const contentType = mediaType(fetched.headers);
		if (fetched.status === 304 && before) {
			return {
				seen: null,
				contentType,
				url: fetched.url,
				...marks,
			};
		}
		let seen: Seen;
		try {
			seen = await see(fetched);
		} catch (error) {
			seen = {
				status: "failed",
				reason: `The page could not be read: ${messageOf(error)}.`,
			};
		}
		return { seen, contentType, url: fetched.url, ...marks };
	}

	return {
		kind: "nightshift",
		look,
		async read(url, options) {
			const looked = await look(url, options);
			const { seen } = looked;
			const marks = {
				...(looked.etag ? { etag: looked.etag } : {}),
				...(looked.lastModified ? { lastModified: looked.lastModified } : {}),
			};
			if (seen === null) {
				const before = options.before as ReadMark;
				return { status: "unchanged", mark: { ...before, ...marks } };
			}
			if ("status" in seen) return seen;
			const links = "links" in seen ? seen.links : [];
			const mark = {
				...marks,
				fingerprint: fingerprintOf(seen.title, seen.markdown),
			};
			if (options.before?.fingerprint === mark.fingerprint) {
				return { status: "unchanged", mark };
			}
			return {
				status: "read",
				title: seen.title,
				markdown: seen.markdown,
				links,
				mark,
				contentType: looked.contentType,
			};
		},
	};
}
