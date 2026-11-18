/**
 * The secrets a node's own text reads: each `${NAME}` in it. A Web request
 * and a Wait for a URL fill them in, and the Secrets page lists them.
 */

/** A secret reference in a node's own text: `${API_TOKEN}`. */
const SECRET_REF = /\$\{([A-Za-z_][A-Za-z0-9_]{0,127})\}/g;

/**
 * Text with secrets in it: each `${NAME}` is a part of its own, the rest
 * is text. Only a node's own text is split: a value that a template
 * renders stays text, so a `${NAME}` in it is never filled.
 */
export type SecretPart = { text: string } | { secret: string };

/** `text` as parts: its text and its `${NAME}` references, in order. */
export function secretParts(text: string): SecretPart[] {
	const parts: SecretPart[] = [];
	let last = 0;
	for (const match of text.matchAll(SECRET_REF)) {
		if (match.index > last) parts.push({ text: text.slice(last, match.index) });
		parts.push({ secret: match[1] ?? "" });
		last = match.index + match[0].length;
	}
	if (last < text.length || parts.length === 0) {
		parts.push({ text: text.slice(last) });
	}
	return parts;
}

/** The secrets `text` reads: each `${NAME}` in it, in order. */
export function secretNamesIn(text: string): string[] {
	return secretParts(text).flatMap((part) =>
		"secret" in part ? [part.secret] : [],
	);
}
