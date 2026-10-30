import { Refusal } from "@nightshift/refusal";

/**
 * The export's headers: what a backend wants with every request, often an
 * API key. They are kept like a secret, in this computer's keychain (or a
 * file only this user can read, on a computer without one), never in the
 * Device document, the log or a reply: a reader sees their names only.
 */

/** Where the headers are kept: this computer's value store. */
export type HeaderValues = {
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
	delete(name: string): Promise<void>;
};

/** The name the headers are kept under in the value store. */
const KEPT_AS = "otlp-headers";

/** A header name, as HTTP allows it. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Reads headers a person wrote: one per line or comma separated, as
 * `name=value` or `name: value` (`Authorization=Bearer abc`). Throws a
 * refusal that says which part is not valid.
 */
export function parseHeaders(text: string): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const raw of text.split(/[\n,]/)) {
		const part = raw.trim();
		if (part === "") continue;
		const at = part.search(/[=:]/);
		const name = at > 0 ? part.slice(0, at).trim() : "";
		const value = at > 0 ? part.slice(at + 1).trim() : "";
		if (!HEADER_NAME.test(name) || value === "") {
			throw new Refusal(
				"invalid",
				`Check the format of "${name || part.slice(0, 20)}". Write each header as name=value, for example Authorization=Bearer abc123.`,
			);
		}
		headers[name] = value;
	}
	return headers;
}

/** The kept headers over a value store. */
export function keptHeaders(values: HeaderValues) {
	return {
		async read(): Promise<Record<string, string>> {
			const raw = await values.get(KEPT_AS);
			if (!raw) return {};
			try {
				const parsed = JSON.parse(raw) as unknown;
				if (parsed === null || typeof parsed !== "object") return {};
				return Object.fromEntries(
					Object.entries(parsed).filter(
						(entry): entry is [string, string] => typeof entry[1] === "string",
					),
				);
			} catch {
				return {};
			}
		},
		/** Keeps these headers in place of the ones before. None: forgets them. */
		async write(headers: Readonly<Record<string, string>>): Promise<void> {
			if (Object.keys(headers).length === 0) await values.delete(KEPT_AS);
			else await values.set(KEPT_AS, JSON.stringify(headers));
		},
	};
}
