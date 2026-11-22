import type { AddressRules } from "../../../../web-access";
import type { PageReader } from "../../application/ports";
import {
	linksOfMarkdown,
	nameOfAddress,
	READER_USER_AGENT,
	readOrUnchanged,
} from "../../domain/page-read";
import { fetchGuarded } from "./fetch-guarded";

/**
 * Jina Reader as a page reader (ADR 39): `GET <address><url>`, at
 * `https://r.jina.ai/` or a self-hosted Reader. A key is optional: it
 * goes as a Bearer token and lifts the rate limit.
 *
 * The Reader answers in its text format: `Title:`, `URL Source:`, then
 * `Markdown Content:` and the page. It answers 200 for a page that is gone
 * or behind a bot check too, and says so in a `Warning:` line above the
 * content: `Target URL returned error 404: Not Found`, or `This page maybe
 * requiring CAPTCHA`. The Web pages kit read those lines the same way
 * before it had readers.
 */

const READ_TIMEOUT_MS = 120_000;

/** What a page of the Reader's text format says above its content. */
type Head = { title: string; source: string; warnings: string[] };

function headOf(text: string): { head: Head; markdown: string } {
	const at = text.indexOf("Markdown Content:");
	const top = at >= 0 ? text.slice(0, at) : "";
	const markdown = (
		at >= 0 ? text.slice(at + "Markdown Content:".length) : text
	).trim();
	const line = (name: string) =>
		top
			.split("\n")
			.filter((one) => one.startsWith(`${name}:`))
			.map((one) => one.slice(name.length + 1).trim());
	return {
		head: {
			title: line("Title")[0] ?? "",
			source: line("URL Source")[0] ?? "",
			warnings: line("Warning"),
		},
		markdown,
	};
}

export function jinaReader(deps: {
	address: string;
	key?: string;
	rules: () => AddressRules;
}): PageReader {
	const address = deps.address.endsWith("/")
		? deps.address
		: `${deps.address}/`;
	return {
		kind: "jina",
		async read(url, { before, signal }) {
			const fetched = await fetchGuarded(`${address}${url}`, {
				headers: {
					"user-agent": READER_USER_AGENT,
					...(deps.key ? { authorization: `Bearer ${deps.key}` } : {}),
				},
				...(signal ? { signal } : {}),
				timeoutMs: READ_TIMEOUT_MS,
				maxBytes: 20 * 1024 * 1024,
				rules: deps.rules(),
			});
			if (fetched.kind !== "response") {
				return {
					status: "failed",
					reason: `Jina Reader could not be reached. ${fetched.message}`,
				};
			}
			if (fetched.status === 401 || fetched.status === 403) {
				return {
					status: "failed",
					reason:
						"Jina Reader did not accept its key. Check the secret it reads.",
				};
			}
			if (fetched.status === 402 || fetched.status === 429) {
				return {
					status: "failed",
					reason:
						"Jina Reader asks to slow down, or its key has no credit left. Try again later.",
				};
			}
			const text = new TextDecoder().decode(fetched.body);
			if (fetched.status === 422 || fetched.status === 400) {
				return {
					status: "failed",
					reason: "Jina Reader cannot read this address.",
				};
			}
			if (fetched.status < 200 || fetched.status >= 300) {
				return {
					status: "failed",
					reason: `Jina Reader answered with an error (${fetched.status}).`,
				};
			}
			const { head, markdown } = headOf(text);
			for (const warning of head.warnings) {
				const code = /Target URL returned error (\d+)/.exec(warning)?.[1];
				if (code === "404" || code === "410") {
					return { status: "gone", reason: "The page is not there any more." };
				}
				if (code === "401") {
					return {
						status: "signin",
						reason: "The page asks you to sign in first.",
					};
				}
				if (code !== undefined) {
					return {
						status: "blocked",
						reason: "The site does not let readers in.",
					};
				}
				if (/CAPTCHA/i.test(warning)) {
					return {
						status: "blocked",
						reason: "The site checks for robots first.",
					};
				}
			}
			if (markdown === "") {
				return {
					status: "needs-browser",
					reason: "The page has no text to read.",
				};
			}
			return readOrUnchanged(
				{
					title: head.title || nameOfAddress(url),
					markdown,
					links: linksOfMarkdown(markdown, head.source || url),
					contentType: "text/html",
				},
				before,
			);
		},
	};
}
