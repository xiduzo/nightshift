/**
 * How one file of the knowledge is called: its title and its first
 * sentence. `INDEX.md`, the search index and every read take the same
 * title (`describeFile`).
 */

/**
 * One page of a PDF or Word file, as the loaders of `file-loaders` give it
 * (a LangChain `Document` has this shape). Its text is tidied already.
 */
export type DocumentPage = {
	pageContent: string;
	metadata: { title?: string; loc?: { pageNumber: number } };
};

/** What `describeFile` reads of a file: a PDF or Word file's pages, else the start of its text. */
export type DescribedSource =
	| { docs: readonly DocumentPage[] | null }
	| { text: string };

/** A file's title and its first sentence. */
export type Description = { title: string; sentence: string };

/** What the index reads of a file for its title and first sentence. */
export const HEAD_BYTES = 4096;
/** The files whose text the index reads, besides PDF and Word files. Any other file shows its name only. */
const TEXT_FILES = new Set([".md", ".markdown", ".mdx", ".txt", ".rst"]);

/** The extension of a path's file name, with its dot, as `node:path` gives it. */
function extensionOf(path: string): string {
	const name = path.split("/").at(-1) ?? path;
	const dot = name.lastIndexOf(".");
	return dot <= 0 || name === ".." ? "" : name.slice(dot);
}

/** Whether the text of a file is read for its title: a text file. */
export const isText = (path: string) =>
	TEXT_FILES.has(extensionOf(path).toLowerCase());

/** A file's title when its text gives none: its name without the extension. */
function fallbackTitle(path: string): string {
	const name = path.split("/").at(-1) ?? path;
	return name.slice(0, name.length - extensionOf(name).length) || name;
}

/**
 * The text of a document's pages, as `textOf` of `file-loaders` gives it:
 * an empty line between pages, the text tidied.
 */
export function pagesText(docs: readonly DocumentPage[]): string {
	return docs
		.map((doc) => doc.pageContent)
		.join("\n\n")
		.replace(/\r\n?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * A file's title and first sentence, as the index, the search index and a
 * read all give them. A PDF or Word file: from its text (`docs`), its name
 * when that did not open. A text file: from the start of its text. Any other
 * file: its name.
 */
export function describeFile(
	path: string,
	content: DescribedSource,
): Description {
	const name = path.split("/").at(-1) ?? path;
	const nameOnly = { title: name, sentence: "" };
	if ("docs" in content) {
		return content.docs === null
			? nameOnly
			: describeDocument(content.docs, fallbackTitle(path));
	}
	return isText(path)
		? describeText(content.text.slice(0, HEAD_BYTES), fallbackTitle(path))
		: nameOnly;
}

/**
 * The title and first sentence of a document's text: its first line is
 * the title when it is short and ends without a stop, else the file name.
 */
function describeDocumentText(text: string, fallback: string): Description {
	const lines = text
		.split("\n")
		.map(oneLine)
		.filter((line) => line !== "");
	const first = lines[0] ?? "";
	const isTitle =
		first.length > 0 && first.length <= 100 && !/[.!?:;,]$/.test(first);
	const rest = isTitle ? lines.slice(1) : lines;
	return {
		title: isTitle ? first : fallback,
		sentence: rest.length > 0 ? firstSentence(rest.join(" ")) : "",
	};
}

/**
 * The title and first sentence of a PDF or Word file: the title the
 * document itself gives, else the one its text gives.
 */
function describeDocument(
	docs: readonly DocumentPage[],
	fallback: string,
): Description {
	const fromText = describeDocumentText(
		pagesText(docs).slice(0, HEAD_BYTES),
		fallback,
	);
	const title = docs[0]?.metadata.title;
	return title ? { ...fromText, title } : fromText;
}

/**
 * The title (`title:` of the front matter, else the first heading, else
 * the file name) and the first sentence of the first paragraph.
 */
function describeText(
	text: string,
	fallback: string,
): { title: string; sentence: string } {
	let title = "";
	let sentence = "";
	let inFrontMatter = false;
	let inFence = false;
	const lines = text.split(/\r?\n/);
	for (const [i, raw] of lines.entries()) {
		const line = raw.trim();
		if (i === 0 && line === "---") {
			inFrontMatter = true;
			continue;
		}
		if (inFrontMatter) {
			if (line === "---") inFrontMatter = false;
			else if (!title) {
				const match = /^title:\s*["']?(.+?)["']?\s*$/.exec(line);
				if (match?.[1]) title = match[1];
			}
			continue;
		}
		if (line.startsWith("```") || line.startsWith("~~~")) {
			inFence = !inFence;
			continue;
		}
		if (inFence || line === "") continue;
		const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
		if (heading?.[1]) {
			if (!title) title = heading[1];
			continue;
		}
		if (/^(<|!\[|\||>|[-*_]{3,}$)/.test(line)) continue;
		if (!sentence) {
			sentence = firstSentence(line);
			if (title) break;
		}
	}
	return { title: oneLine(title) || fallback, sentence };
}

/** The first sentence of a line, at most 200 characters. */
function firstSentence(line: string): string {
	const plain = oneLine(line.replace(/^[-*+]\s+|^\d+\.\s+/, ""));
	const end = /[.!?](\s|$)/.exec(plain);
	const sentence = end ? plain.slice(0, end.index) : plain;
	return sentence.length > 200 ? `${sentence.slice(0, 199)}…` : sentence;
}

/** A text on one line: no line breaks, no runs of spaces, no backticks. */
export function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").replace(/`/g, "'").trim();
}
