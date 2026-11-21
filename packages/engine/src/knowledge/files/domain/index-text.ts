import { iso } from "@nightshift/time";
import { type Description, oneLine } from "./describe";
import type { KnowledgeFile } from "./paths";

/**
 * `INDEX.md`, which Night Shift writes at the top of a knowledge folder:
 * one line per file, with its path, title, first sentence and when it last
 * changed, and the headings of the largest markdown files. It is written
 * again when it is stale: a file is newer than it, or a file came or went.
 */

/** One heading of a markdown text. */
export type MarkdownHeading = { level: number; text: string };

/** What the index asks of markdown (`sections.ts` of the search): which files are markdown, and their headings. */
export type MarkdownRules = {
	isMarkdown(path: string): boolean;
	headings(text: string): MarkdownHeading[];
};

/**
 * The markdown files whose headings the index shows: the largest ones, where
 * structure helps most. An agent reads the index first, so it stays small:
 * with the next limits, headings add about 30 000 characters at most. And each
 * write reads at most this many files, at `OUTLINE_BYTES` each. No PDF or Word
 * file is read for this, so a step's start does not wait for one.
 */
const MAX_OUTLINED_FILES = 100;
/** The headings one file shows, at most. */
const MAX_OUTLINE_HEADINGS = 12;
/** The length of the headings of one file together, at most. */
const MAX_OUTLINE_CHARS = 300;
/** The length of one heading, at most. */
const MAX_OUTLINE_HEADING = 80;
/** What the index reads of a file for its headings. */
export const OUTLINE_BYTES = 256 * 1024;
const OUTLINE_SEPARATOR = " · ";

/** What a folder's index is now, as far as its staleness goes. */
export type WrittenIndex = { mtimeMs: number; text: string };

/**
 * Whether the index of a folder is stale: there is none, a file is newer
 * than it, it is of another version (no `intro`), or it lists other paths.
 */
export function indexIsStale(
	written: WrittenIndex | null,
	files: readonly KnowledgeFile[],
	newest: number,
	intro: string,
): boolean {
	return (
		written === null ||
		newest > written.mtimeMs ||
		!written.text.includes(intro) ||
		!samePaths(indexedPaths(written.text), files)
	);
}

/** The paths an index lists: each line starts with the path in backticks. */
function indexedPaths(text: string): string[] {
	const paths: string[] = [];
	for (const line of text.split("\n")) {
		const match = /^- `([^`]+)`/.exec(line);
		if (match?.[1]) paths.push(match[1]);
	}
	return paths;
}

function samePaths(a: readonly string[], files: readonly KnowledgeFile[]) {
	return a.length === files.length && a.every((p, i) => p === files[i]?.path);
}

/** The files whose headings the index shows: the largest markdown files. */
export function outlinedPaths(
	files: readonly KnowledgeFile[],
	isMarkdown: (path: string) => boolean,
): Set<string> {
	return new Set(
		files
			.filter((file) => isMarkdown(file.path))
			.sort((a, b) => b.size - a.size)
			.slice(0, MAX_OUTLINED_FILES)
			.map((file) => file.path),
	);
}

/** One line of the index for a file, with its headings under it when it has some. */
export function indexLine(
	file: KnowledgeFile,
	{ title, sentence }: Description,
	outline: string,
): string {
	const day = iso(file.changedAt).slice(0, 10);
	const line = `- \`${file.path}\`: ${title}${sentence ? `. ${sentence}` : ""} (changed ${day})`;
	return outline ? `${line}\n  ${outline}` : line;
}

/** The text of `INDEX.md` with these lines. */
export function indexText(lines: readonly string[], intro: string): string {
	return [
		"# Knowledge index",
		"",
		intro,
		"",
		...(lines.length > 0 ? lines : ["No files yet."]),
		"",
	].join("\n");
}

/**
 * The text whose headings the index shows, from the start of a file
 * (`OUTLINE_BYTES` of it, `size` of the whole). `whole`: this is the whole
 * file. A cut can fall in a line: a heading cut in two is left out.
 */
export function outlineSource(head: { text: string; size: number }): {
	text: string;
	whole: boolean;
} {
	const whole = head.size <= OUTLINE_BYTES;
	const text = whole
		? head.text
		: head.text.slice(0, head.text.lastIndexOf("\n"));
	return { text: text.replace(/\r\n?/g, "\n"), whole };
}

/**
 * The headings of a markdown text on one line, for the index: the top level
 * under the title, then each deeper level while all of it fits. Past the
 * limits it says how many more there are. `whole`: this is the whole file, so
 * the count is right. If not, it says only that more may follow.
 */
export function outlineOf(
	headingsOfText: readonly MarkdownHeading[],
	title: string,
	whole: boolean,
): string {
	const all = headingsOfText.map((heading) => ({
		...heading,
		text: oneLine(heading.text),
	}));
	const headings = all[0]?.text === title ? all.slice(1) : all;
	const levels = [...new Set(headings.map((h) => h.level))].sort(
		(a, b) => a - b,
	);
	let shown: typeof headings = [];
	for (const level of levels) {
		const upTo = headings.filter((h) => h.level <= level);
		if (shown.length > 0 && upTo.length > MAX_OUTLINE_HEADINGS) break;
		shown = upTo;
	}
	const kept: string[] = [];
	let chars = 0;
	for (const { text: heading } of shown.slice(0, MAX_OUTLINE_HEADINGS)) {
		const short =
			heading.length > MAX_OUTLINE_HEADING
				? `${heading.slice(0, MAX_OUTLINE_HEADING - 1)}…`
				: heading;
		chars += short.length + OUTLINE_SEPARATOR.length;
		if (chars > MAX_OUTLINE_CHARS) break;
		kept.push(short);
	}
	if (kept.length === 0) return "";
	const hidden = shown.length - kept.length;
	if (hidden > 0) kept.push(whole ? `… ${hidden} more` : "… more");
	else if (!whole) kept.push("…");
	return kept.join(OUTLINE_SEPARATOR);
}
