/**
 * The edits the generators make to files that exist: a new import, a new
 * member of an object or a type, a new line of the capability map. Each
 * takes the text of a file and returns the new text. It throws when the
 * file does not have the shape it expects: then a person adds the line.
 * Biome formats and sorts the files after the generator ran.
 */

/** What the generator will not do, and why: it makes no file then. */
export class GeneratorRefusal extends Error {}

/** `text` with `line` as its first line. Biome sorts the imports after. */
export function withImport(text: string, line: string): string {
	return `${line}\n${text}`;
}

/** Where an object or a type literal opens, as `withMember` finds it. */
export type Opening = {
	/** The line that opens the literal: it ends with `{`, or holds it whole on one line. */
	opener: RegExp;
	/** A line before the opener that the search starts at. */
	after?: RegExp;
};

/**
 * `text` with `member` (one or more lines, each with its own `,` or `;`) as
 * the last member of the literal that opens at `at`. A literal on one line
 * is spread over several lines first.
 */
export function withMember(
	text: string,
	at: Opening,
	member: readonly string[],
	what: string,
): string {
	const lines = text.split("\n");
	const from = at.after ? lines.findIndex((line) => at.after?.test(line)) : 0;
	const open = lines.findIndex(
		(line, index) => from >= 0 && index >= from && at.opener.test(line),
	);
	const line = lines[open];
	if (line === undefined) {
		throw new GeneratorRefusal(`Cannot find ${what}.`);
	}
	const indent = /^\s*/.exec(line)?.[0] ?? "";
	const inner = member.map((part) => `${indent}\t${part}`);

	if (line.trimEnd().endsWith("{")) {
		const close = lines.findIndex(
			(next, index) => index > open && next.startsWith(`${indent}}`),
		);
		if (close < 0)
			throw new GeneratorRefusal(`Cannot find the end of ${what}.`);
		lines.splice(close, 0, ...inner);
		return lines.join("\n");
	}

	// One line: `const ports = { access: deps.access };`.
	const one = /^(\s*.*\{)\s*(.*?)\s*(\}.*)$/.exec(line);
	if (!one) throw new GeneratorRefusal(`Cannot read ${what}.`);
	const [, head = "", body = "", tail = ""] = one;
	const end = member.at(-1)?.endsWith(";") ? ";" : ",";
	const before = body
		? [`${indent}\t${/[,;]$/.test(body) ? body : `${body}${end}`}`]
		: [];
	lines.splice(open, 1, head, ...before, ...inner, `${indent}${tail}`);
	return lines.join("\n");
}

/** `space-move` is written with quotes in an object, `spend` without. */
const key = (name: string) =>
	/^[a-z][a-z0-9]*$/.test(name) ? name : `"${name}"`;

/** The name of the entry on a line of the map, or null. */
const entryOf = (line: string) =>
	/^\t\t"?([a-z0-9-]+)"?: /.exec(line)?.[1] ?? null;

/**
 * The text of `scripts/capabilities.ts` with the vertical `vertical` of
 * `packages/<pkg>` placed in `place`, in the name order of the map. The
 * line goes before the comment of the entry it precedes.
 */
export function withMapLine(
	text: string,
	pkg: string,
	vertical: string,
	place: string,
): string {
	const lines = text.split("\n");
	const start = lines.indexOf(`\t"packages/${pkg}": {`);
	const end = lines.findIndex(
		(line, index) => index > start && line === "\t},",
	);
	if (start < 0 || end < 0) {
		throw new GeneratorRefusal(
			`scripts/capabilities.ts: cannot find the map of packages/${pkg}.`,
		);
	}
	let at = end;
	for (let index = start + 1; index < end; index++) {
		const name = entryOf(lines[index] ?? "");
		if (name === vertical) {
			throw new GeneratorRefusal(
				`scripts/capabilities.ts: packages/${pkg} has ${vertical} already.`,
			);
		}
		if (name && name.localeCompare(vertical) > 0 && at === end) {
			at = index;
			while (lines[at - 1]?.startsWith("\t\t//")) at--;
		}
	}
	lines.splice(at, 0, `\t\t${key(vertical)}: "${place}",`);
	return lines.join("\n");
}
