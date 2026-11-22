import { type AddressRules, checkHost } from "../../../../web-access";
import { messageOf } from "../../domain/page-read";

/**
 * One request of a page reader, by the rule of every request of this
 * computer (`web-access`): each address of each hop is checked before
 * it connects, so a Host reads its private network only when its Settings
 * allow it. It follows at most `MAX_REDIRECTS` redirects itself, never
 * takes a key to another server, and reads at most `maxBytes` of the
 * answer. Never throws.
 */

const MAX_REDIRECTS = 5;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Headers that never follow a redirect to another server. */
const CREDENTIALS = new Set(["authorization", "cookie", "proxy-authorization"]);

export type Fetched =
	| {
			kind: "response";
			status: number;
			headers: Headers;
			/** Where the answer came from, after redirects. */
			url: string;
			/** Every address the request went through, the first one too. */
			hops: string[];
			body: Uint8Array;
			/** The answer was larger than `maxBytes`: `body` is its start. */
			cut: boolean;
	  }
	| { kind: "refused"; message: string }
	| { kind: "failed"; message: string };

export type FetchOptions = {
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
	/** How long the whole request may take. */
	timeoutMs: number;
	maxBytes: number;
	rules: AddressRules;
};

/** The start of a body, at most `maxBytes`. */
async function readBody(
	response: Response,
	maxBytes: number,
): Promise<{ body: Uint8Array; cut: boolean }> {
	const reader = response.body?.getReader();
	if (!reader) return { body: new Uint8Array(), cut: false };
	const parts: Uint8Array[] = [];
	let size = 0;
	let cut = false;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
		size += value.byteLength;
		if (size > maxBytes) {
			cut = true;
			await reader.cancel().catch(() => {});
			break;
		}
	}
	const body = new Uint8Array(Math.min(size, maxBytes));
	let at = 0;
	for (const part of parts) {
		const take = part.subarray(0, body.length - at);
		body.set(take, at);
		at += take.byteLength;
		if (at >= body.length) break;
	}
	return { body, cut };
}

export async function fetchGuarded(
	address: string,
	options: FetchOptions,
): Promise<Fetched> {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return { kind: "refused", message: "This is not a web address." };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			kind: "refused",
			message: "The address must start with http:// or https://.",
		};
	}
	const timeout = AbortSignal.timeout(options.timeoutMs);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeout])
		: timeout;
	let method = options.method ?? "GET";
	let body = options.body;
	let headers = { ...options.headers };
	const hops = [url.href];
	for (let hop = 0; ; hop++) {
		const check = await checkHost(url, options.rules);
		if (check.kind === "unresolved") {
			return {
				kind: "failed",
				message: `Could not find ${url.host}: ${check.message}.`,
			};
		}
		if (check.kind === "blocked") {
			const message =
				check.why === "never"
					? `${url.host} is a link-local, metadata or reserved address. Night Shift never reads there.`
					: `${url.host} is on this computer or its private network. A Host reads there only when its Settings allow it.`;
			return { kind: "refused", message };
		}
		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers,
				...(body !== undefined ? { body } : {}),
				redirect: "manual",
				signal,
			});
		} catch (error) {
			if (timeout.aborted) {
				return {
					kind: "failed",
					message: `${url.host} did not answer within ${Math.round(options.timeoutMs / 1000)} s.`,
				};
			}
			return {
				kind: "failed",
				message: `Could not reach ${url.host}: ${messageOf(error)}.`,
			};
		}
		const location = response.headers.get("location");
		if (REDIRECTS.has(response.status) && location !== null) {
			await response.body?.cancel().catch(() => {});
			let next: URL;
			try {
				next = new URL(location, url);
			} catch {
				return {
					kind: "failed",
					message: `${url.host} redirected to an address that is not valid.`,
				};
			}
			if (hop >= MAX_REDIRECTS || !/^https?:$/.test(next.protocol)) {
				return {
					kind: "failed",
					message: `${url.host} redirected too often, or away from the web.`,
				};
			}
			if (next.origin !== url.origin) {
				headers = Object.fromEntries(
					Object.entries(headers).filter(
						([name]) => !CREDENTIALS.has(name.toLowerCase()),
					),
				);
			}
			// As a browser does: a 303, or a 301 or 302 after a POST, asks again with GET.
			if (
				response.status === 303 ||
				((response.status === 301 || response.status === 302) &&
					method === "POST")
			) {
				method = "GET";
				body = undefined;
			}
			url = next;
			hops.push(url.href);
			continue;
		}
		try {
			const read = await readBody(response, options.maxBytes);
			return {
				kind: "response",
				status: response.status,
				headers: response.headers,
				url: url.href,
				hops,
				...read,
			};
		} catch (error) {
			return {
				kind: "failed",
				message: `${url.host} stopped while it answered: ${messageOf(error)}.`,
			};
		}
	}
}
