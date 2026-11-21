import { Refusal } from "@nightshift/refusal";
import { type DocumentPage, describeFile, pagesText } from "./describe";

/**
 * One file of the knowledge as a read gives it: its text, cut at the size
 * asked for, from a spot when one is asked for.
 */

/** One file of the folder, read for a person or an agent. */
export type KnowledgeText = {
	path: string;
	title: string;
	/** The text, cut at the size asked for. */
	text: string;
	/** Bytes of the whole file. For a PDF or Word file: of its whole text. */
	size: number;
	/** The text stops before the file ends. */
	truncated: boolean;
	/**
	 * Where the text starts, for a read from a spot (`ReadFrom`): its
	 * line, of the file or of its page, and its page. Absent: from the
	 * start of the file.
	 */
	from?: { line: number; page: number | null };
};

/** A spot of a file to read from: a section by its heading or words, a line, a page (`KnowledgeReadFrom` of `agents`). */
export type ReadFrom = { section?: string; line?: number; page?: number };

/** The first `bytes` of a text, cut at a character, and the size of the whole. */
export function cutText(
	text: string,
	bytes: number,
): { text: string; size: number } {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.length <= bytes) return { text, size: buffer.length };
	// A cut inside a character drops that character.
	const cut = buffer.subarray(0, bytes).toString("utf8").replace(/�$/, "");
	return { text: cut, size: buffer.length };
}

/** A PDF or Word file's text as a read gives it, or a Refusal when it gives none. */
export function documentResult(
	path: string,
	docs: readonly DocumentPage[] | null,
	maxBytes: number,
	from?: ReadFrom,
): KnowledgeText {
	if (docs === null) {
		throw new Refusal(
			"invalid",
			`Night Shift cannot read the text of "${path}".`,
		);
	}
	const title = describeFile(path, { docs }).title;
	const spot = readFrom(path, title, documentPages(docs), from, maxBytes);
	if (spot) return spot;
	const text = pagesText(docs);
	const cut = cutText(text, maxBytes);
	return {
		path,
		title,
		text: cut.text,
		size: cut.size,
		truncated: cut.size > maxBytes,
	};
}

/** One page of a file's text: a PDF's page, or the whole text of any other file (page null). */
type TextPage = { text: string; page: number | null };

/** Whether a line is the markdown heading of `section`, or has its words. */
const headingOf = (line: string) =>
	/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1]?.trim().toLowerCase();

/**
 * The text of `pages` from the spot `from` names, and where it starts.
 * Null when `from` names nothing, or nothing it names is there.
 */
export function textFrom(
	pages: readonly TextPage[],
	from: ReadFrom | undefined,
): { text: string; line: number; page: number | null } | null {
	if (!from || (from.section === undefined && !from.line && !from.page)) {
		return null;
	}
	const first =
		from.page === undefined
			? 0
			: pages.findIndex((page) => page.page === from.page);
	if (first === -1) return null;
	const rest = pages.slice(first);
	const at = (index: number, line: number) => {
		const page = rest[index] as TextPage;
		const lines = page.text.split("\n");
		const start = Math.min(Math.max(1, line), lines.length);
		return {
			text: [
				lines.slice(start - 1).join("\n"),
				...rest.slice(index + 1).map((p) => p.text),
			].join("\n\n"),
			line: start,
			page: page.page,
		};
	};
	const wanted = from.section?.trim().toLowerCase();
	if (wanted) {
		for (const pass of ["heading", "words"] as const) {
			for (const [index, page] of rest.entries()) {
				const lines = page.text.split("\n");
				const skip = index === 0 && from.line ? from.line - 1 : 0;
				const found = lines.findIndex(
					(line, i) =>
						i >= skip &&
						(pass === "heading"
							? headingOf(line) === wanted
							: line.toLowerCase().includes(wanted)),
				);
				if (found !== -1) return at(index, found + 1);
			}
		}
		return null;
	}
	return at(0, from.line ?? 1);
}

/** The read of `pages` from `from`, at most `maxBytes`, or null when `from` finds no spot. */
function readFrom(
	path: string,
	title: string,
	pages: readonly TextPage[],
	from: ReadFrom | undefined,
	maxBytes: number,
): KnowledgeText | null {
	const found = textFrom(pages, from);
	if (!found) return null;
	const cut = cutText(found.text, maxBytes);
	return {
		path,
		title,
		text: cut.text,
		size: Buffer.byteLength(pages.map((p) => p.text).join("\n\n")),
		truncated: cut.size > maxBytes,
		from: { line: found.line, page: found.page },
	};
}

/** The pages of a document, for a read from a spot. */
function documentPages(docs: readonly DocumentPage[]): TextPage[] {
	return docs.map((doc, i) => ({
		text: doc.pageContent.replace(/\r\n?/g, "\n"),
		page: doc.metadata.loc?.pageNumber ?? (docs.length > 1 ? i + 1 : null),
	}));
}

/** A file's first bytes as a read gives them, or a Refusal when they are not text. */
export function textResult(
	path: string,
	text: string,
	size: number,
	maxBytes: number,
): KnowledgeText {
	if (text.includes("\u0000")) {
		throw new Refusal("invalid", `"${path}" is not a text file.`);
	}
	return {
		path,
		title: describeFile(path, { text }).title,
		text,
		size,
		truncated: size > maxBytes,
	};
}

/**
 * A text file's read from the spot `from`, over its whole text (at most
 * 10 MB), else from its start as `textResult` gives it.
 */
export function textResultFrom(
	path: string,
	whole: string,
	size: number,
	maxBytes: number,
	from: ReadFrom | undefined,
): KnowledgeText {
	const start = textResult(path, cutText(whole, maxBytes).text, size, maxBytes);
	const spot = readFrom(
		path,
		start.title,
		[{ text: whole.replace(/\r\n?/g, "\n"), page: null }],
		from,
		maxBytes,
	);
	return spot ? { ...spot, size } : start;
}

/** A PDF or Word file over 10 MB: its text is not read. */
export function tooLarge(path: string): Refusal {
	return new Refusal(
		"unavailable",
		`"${path}" is larger than 10 MB. Night Shift does not read its text.`,
	);
}
