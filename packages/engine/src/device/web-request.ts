import type { JsonValue, WebRequestMethod } from "@nightshift/flows";

import type { WebRequestResult, WebResponse } from "./types";
import { type AddressRules, checkHost } from "./web-addresses";

/**
 * One HTTP request as the Device sends it, with every secret filled in:
 * the core of a Web request step and of a Wait for a URL. It checks every
 * address before it connects (`web-addresses.ts`), follows at most
 * `MAX_REDIRECTS` redirects itself, and reads at most `maxBytes` of the
 * answer. Never throws.
 */

/** How many redirects a request follows. */
export const MAX_REDIRECTS = 5;

/** A header as it goes out. `secret`: its value holds a secret, so it never follows a redirect to another server. */
export type OutgoingHeader = { name: string; value: string; secret: boolean };

export type OutgoingRequest = {
	method: WebRequestMethod;
	url: string;
	headers: readonly OutgoingHeader[];
	body?: { contentType: string; text: string };
	timeoutMs: number;
	maxBytes: number;
	/**
	 * Whether a message may name the URL's server. False when the URL came
	 * from a secret: the address of a webhook is its key.
	 */
	showHost: boolean;
	signal: AbortSignal;
};

/** Headers a request never sends to another server after a redirect. */
const CREDENTIAL_HEADERS = new Set([
	"authorization",
	"cookie",
	"proxy-authorization",
]);

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** A size for a message: "1 MB", "2.5 MB", "300 KB". */
export function sizeText(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	if (mb >= 1) return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The server as a message names it, or a plain word when it must stay hidden. */
function serverOf(url: URL, show: boolean): string {
	return show ? url.host : "the server";
}

/** A message that starts with the server's name or with "the server". */
function capital(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Sends the request. Every outcome is a result: nothing throws. */
export async function sendRequest(
	request: OutgoingRequest,
	rules: AddressRules,
): Promise<WebRequestResult> {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return {
			kind: "refused",
			message: request.showHost
				? `"${request.url}" is not a valid URL. Use an address such as https://api.example.com/items.`
				: "The secret does not hold a valid URL. Save an address such as https://hooks.example.com/… in it.",
		};
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			kind: "refused",
			message: "The URL must start with http:// or https://.",
		};
	}
	for (const header of request.headers) {
		if (/[\r\n]/.test(header.value)) {
			return {
				kind: "refused",
				message: `The header "${header.name}" has a line break. Keep a header on one line.`,
			};
		}
	}
	let method = request.method;
	let body = request.body;
	let headers = [...request.headers];
	let show = request.showHost;
	const timeout = AbortSignal.timeout(request.timeoutMs);
	const signal = AbortSignal.any([request.signal, timeout]);
	for (let hop = 0; ; hop++) {
		const check = await checkHost(url, rules);
		if (check.kind === "unresolved") {
			return {
				kind: "failed",
				message: `Could not find ${serverOf(url, show)}: ${check.message}`,
				network: true,
			};
		}
		if (check.kind === "blocked") {
			const where = show ? url.host : "This address";
			const message =
				check.why === "never"
					? `${where} is a link-local, metadata or reserved address. Night Shift never sends web requests there.`
					: `${where} is on this computer or its private network. A Host sends web requests there only when its Settings allow it.`;
			return hop === 0
				? { kind: "refused", message }
				: {
						kind: "failed",
						message: `A redirect led away: ${message}`,
						network: false,
					};
		}
		const sent: [string, string][] = headers.map((h) => [h.name, h.value]);
		if (body && !headers.some((h) => h.name.toLowerCase() === "content-type")) {
			sent.push(["content-type", body.contentType]);
		}
		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers: sent,
				...(body ? { body: body.text } : {}),
				redirect: "manual",
				signal,
			});
		} catch (error) {
			if (timeout.aborted && !request.signal.aborted) {
				return {
					kind: "failed",
					message: `${serverOf(url, show)} did not answer within ${Math.round(request.timeoutMs / 1000)} s`,
					network: true,
				};
			}
			return {
				kind: "failed",
				message: `Could not reach ${serverOf(url, show)}: ${messageOf(error)}`,
				network: true,
			};
		}
		const location = response.headers.get("location");
		if (REDIRECTS.has(response.status) && location !== null) {
			await response.body?.cancel().catch(() => {});
			if (hop >= MAX_REDIRECTS) {
				return {
					kind: "failed",
					message: `${capital(serverOf(url, show))} redirected more than ${MAX_REDIRECTS} times.`,
					network: false,
				};
			}
			let next: URL;
			try {
				next = new URL(location, url);
			} catch {
				return {
					kind: "failed",
					message: `${capital(serverOf(url, show))} redirected to an address that is not valid.`,
					network: false,
				};
			}
			if (next.protocol !== "http:" && next.protocol !== "https:") {
				return {
					kind: "failed",
					message: `${capital(serverOf(url, show))} redirected to an address that is not http:// or https://.`,
					network: false,
				};
			}
			// A redirect to another server never takes the credentials along.
			// That server is not the secret's: a message may name it.
			if (next.origin !== url.origin) {
				headers = headers.filter(
					(h) => !h.secret && !CREDENTIAL_HEADERS.has(h.name.toLowerCase()),
				);
				show = true;
			}
			// As a browser does: a 303, or a 301 or 302 after a POST, asks again with GET.
			if (
				(response.status === 303 && method !== "HEAD") ||
				((response.status === 301 || response.status === 302) &&
					method === "POST")
			) {
				method = "GET";
				body = undefined;
			}
			url = next;
			continue;
		}
		return readAnswer(response, request, method, serverOf(url, show));
	}
}

/** Reads the answer's body, up to `maxBytes`, as JSON when the server says so. */
async function readAnswer(
	response: Response,
	request: OutgoingRequest,
	method: WebRequestMethod,
	server: string,
): Promise<WebRequestResult> {
	const headers: Record<string, string> = {};
	for (const [name, value] of response.headers) headers[name] = value;
	let bytes: Uint8Array;
	if (method === "HEAD" || response.body === null) bytes = new Uint8Array();
	else {
		const read = await readCapped(response.body, request.maxBytes);
		if (read === "too-large") {
			return {
				kind: "failed",
				message: `The answer is larger than ${sizeText(request.maxBytes)}. Raise the size limit of the node, up to 10 MB, or ask for less.`,
				network: false,
			};
		}
		if (read === "cut") {
			return {
				kind: "failed",
				message: `${server} stopped in the middle of its answer`,
				network: true,
			};
		}
		bytes = read;
	}
	const text = new TextDecoder().decode(bytes);
	const answer: WebResponse = {
		status: response.status,
		statusText: response.statusText,
		headers,
		body: bodyOf(text, headers["content-type"] ?? ""),
		bytes: bytes.byteLength,
	};
	return { kind: "answered", response: answer };
}

/** The body: its JSON when the content type says JSON and it reads as JSON, else its text. */
function bodyOf(text: string, contentType: string): JsonValue {
	if (!/\bjson\b|\+json/i.test(contentType) || text.trim() === "") return text;
	try {
		return JSON.parse(text) as JsonValue;
	} catch {
		return text;
	}
}

/** The bytes of a stream, or `too-large` past `max`, or `cut` when it broke off. */
async function readCapped(
	stream: ReadableStream<Uint8Array>,
	max: number,
): Promise<Uint8Array | "too-large" | "cut"> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > max) {
				await reader.cancel().catch(() => {});
				return "too-large";
			}
			chunks.push(value);
		}
	} catch {
		return "cut";
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
}
