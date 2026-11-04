import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	stat,
} from "node:fs/promises";
import { extname, join } from "node:path";
import type { Document } from "@langchain/core/documents";
import { KNOWLEDGE_INDEX_INTRO } from "@nightshift/agents/tools";
import { KNOWLEDGE_INDEX_FILE } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { iso } from "@nightshift/time";
import { writeWhole } from "../archive";
import {
	type DocumentMetadata,
	isDocument,
	LOCAL_ONLY_BYTES,
	loadDocument,
	loadDocumentContent,
	textOf,
} from "./documents";
import {
	type FolderSnapshot,
	isReadable,
	type KnowledgeFile,
	scanFolder,
} from "./folder-snapshot";
import { isMarkdown, markdownHeadings } from "./sections";

/**
 * The knowledge folder of a project: markdown (and any other files) that
 * an agent may read, kept outside the repository and outside every
 * worktree: `<dataDir>/knowledge/<projectId>/`. Each Device has a working
 * copy of the Project's knowledge there, which `createKnowledgeSync` keeps
 * in step with the Space (ADR 4).
 *
 * Sync flows fill it with Commands (the `knowledge/*` kits), through the
 * folder the step gets in `NS_KNOWLEDGE`. Night Shift writes `INDEX.md`
 * at its top itself: one line per file, with its path, title, first
 * sentence and when it last changed. It writes it again when it is stale
 * (a file is newer than it, or a file came or went) at the moment an agent
 * gets the folder and when the Knowledge page reads it. Nothing loads the
 * files into a prompt: the agent reads `INDEX.md`, then searches or greps.
 * A PDF or Word file shows with the title and first sentence of its text.
 *
 * `evals/` is Night Shift's own too (`questions.ts`): the question set
 * syncs, but no index, search or read shows it.
 *
 * `learnings/` is Night Shift's own (`learnings.ts`): the index lists the
 * learnings a person kept, never the proposals that wait.
 *
 * Which files count and what changed is `folder-snapshot.ts`. How one file
 * is read and what it is called is decided here once: `INDEX.md`, the search
 * index and every read take the same read (`readFolderFile`, `knowledgeText`)
 * and the same title (`describeFile`).
 */

/**
 * Past this many files, the folder is too large to read well: the
 * Knowledge page warns: agents find more with `search_knowledge` than by a grep.
 */
export const KNOWLEDGE_FILES_WARNING = 2000;

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
	 * Where the text starts, for a read from a spot (`KnowledgeReadFrom`):
	 * its line, of the file or of its page, and its page. Absent: from the
	 * start of the file.
	 */
	from?: { line: number; page: number | null };
};

/**
 * Where a read starts: a section's heading, a line, a page, as a search
 * hit names them (`KnowledgeHit`). A line counts in its page when a page
 * is given. A section starts at its heading, else at the first line with
 * its words. Nothing given, or nothing found: the start of the file.
 */
export type KnowledgeReadFrom = {
	section?: string;
	line?: number;
	page?: number;
};

/** What the index reads of a file for its title and first sentence. */
const HEAD_BYTES = 4096;
/** The files whose text the index reads, besides PDF and Word files. Any other file shows its name only. */
const TEXT_FILES = new Set([".md", ".markdown", ".mdx", ".txt", ".rst"]);
/** Whether the text of a file is read for its title: a text file. */
export const isText = (path: string) =>
	TEXT_FILES.has(extname(path).toLowerCase());
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
const OUTLINE_BYTES = 256 * 1024;
const OUTLINE_SEPARATOR = " · ";

/** A file's title when its text gives none: its name without the extension. */
function fallbackTitle(path: string): string {
	const name = path.split("/").at(-1) ?? path;
	return name.slice(0, name.length - extname(name).length) || name;
}

/** Whether an id is one file or folder name: nothing that could leave the folder. */
const isId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);

/** An id as one file or folder name: nothing that could leave the folder. */
function folderName(id: string): string {
	if (!isId(id)) {
		throw new Error(`"${id}" is not an id.`);
	}
	return id;
}

/** The knowledge folders of the projects on this computer. */
export type KnowledgeFolders = ReturnType<typeof createKnowledgeFolders>;

export function createKnowledgeFolders(dataDir: string) {
	const root = join(dataDir, "knowledge");
	const folder = (projectId: string) => join(root, folderName(projectId));

	/** The folder, made when it is not there yet. */
	async function ensure(projectId: string): Promise<string> {
		const path = folder(projectId);
		await mkdir(path, { recursive: true });
		return path;
	}

	return {
		folder,
		ensure,
		/** The projects that have a folder on this computer, by id. */
		async known(): Promise<string[]> {
			const names = await readdir(root, { withFileTypes: true }).catch(
				() => [],
			);
			return names
				.filter((entry) => entry.isDirectory() && isId(entry.name))
				.map((entry) => entry.name)
				.sort();
		},
		/** The project's folder as it is now. */
		scan: (projectId: string) => scanFolder(folder(projectId)),
		/**
		 * One file of the folder, by its path, at most `maxBytes` of its
		 * text (`readFolderFile`). Null when the folder has no such file.
		 */
		read: (
			projectId: string,
			path: string,
			maxBytes: number,
			from?: KnowledgeReadFrom,
		) => readFolderFile(folder(projectId), path, maxBytes, from),
	};
}

/**
 * Writes `INDEX.md` at the top of the snapshot's folder again when it is
 * stale, over the files a person or an agent reads there. A folder that is
 * not there is made.
 */
export async function indexFolder(snapshot: FolderSnapshot): Promise<void> {
	const { dir, readable: files, newestReadable: newest } = snapshot;
	const indexPath = join(dir, KNOWLEDGE_INDEX_FILE);
	const written = await stat(indexPath).catch(() => null);
	const text =
		written === null ? "" : await readFile(indexPath, "utf8").catch(() => "");
	const stale =
		written === null ||
		newest > written.mtimeMs ||
		!text.includes(KNOWLEDGE_INDEX_INTRO) ||
		!samePaths(indexedPaths(text), files);
	if (stale) await writeWhole(indexPath, await indexText(dir, files));
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

/** The text of `INDEX.md` for these files. */
async function indexText(
	dir: string,
	files: readonly KnowledgeFile[],
): Promise<string> {
	const outlined = new Set(
		files
			.filter((file) => isMarkdown(file.path))
			.sort((a, b) => b.size - a.size)
			.slice(0, MAX_OUTLINED_FILES)
			.map((file) => file.path),
	);
	const lines = await Promise.all(
		files.map(async (file) => {
			const abs = join(dir, ...file.path.split("/"));
			const { title, sentence } = await describe(abs, file.path);
			const day = iso(file.changedAt).slice(0, 10);
			const line = `- \`${file.path}\`: ${title}${sentence ? `. ${sentence}` : ""} (changed ${day})`;
			const outline = outlined.has(file.path)
				? await readOutline(abs, title)
				: "";
			return outline ? `${line}\n  ${outline}` : line;
		}),
	);
	return [
		"# Knowledge index",
		"",
		KNOWLEDGE_INDEX_INTRO,
		"",
		...(lines.length > 0 ? lines : ["No files yet."]),
		"",
	].join("\n");
}

/** The headings of a markdown file on one line (`outlineOf`). Empty: it has none, or it went. */
async function readOutline(abs: string, title: string): Promise<string> {
	const head = await readStart(abs, OUTLINE_BYTES);
	if (!head) return "";
	const whole = head.size <= OUTLINE_BYTES;
	// A cut can fall in a line: a heading cut in two is left out.
	const text = whole
		? head.text
		: head.text.slice(0, head.text.lastIndexOf("\n"));
	return outlineOf(text.replace(/\r\n?/g, "\n"), title, whole);
}

/**
 * The headings of a markdown text on one line, for the index: the top level
 * under the title, then each deeper level while all of it fits. Past the
 * limits it says how many more there are. `whole`: this is the whole file, so
 * the count is right. If not, it says only that more may follow.
 */
function outlineOf(text: string, title: string, whole: boolean): string {
	const all = markdownHeadings(text).map((heading) => ({
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

type Description = { title: string; sentence: string };

/** A file's title and first sentence, for the index: only what they need is read. */
async function describe(abs: string, path: string): Promise<Description> {
	if (isDocument(path)) {
		return describeFile(path, { docs: await loadDocument(abs) });
	}
	const head = isText(path) ? await readStart(abs, HEAD_BYTES) : null;
	return describeFile(path, { text: head?.text ?? "" });
}

/**
 * A file's title and first sentence, as the index, the search index and a
 * read all give them. A PDF or Word file: from its text (`docs`), its name
 * when that did not open. A text file: from the start of its text. Any other
 * file: its name.
 */
export function describeFile(
	path: string,
	content: { docs: Document<DocumentMetadata>[] | null } | { text: string },
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
	docs: Document<DocumentMetadata>[],
	fallback: string,
): Description {
	const fromText = describeDocumentText(
		textOf(docs).slice(0, HEAD_BYTES),
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

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").replace(/`/g, "'").trim();
}

/** The first `bytes` of a file as text, and its size. Null when it is no file. */
export async function readStart(
	abs: string,
	bytes: number,
): Promise<{ text: string; size: number } | null> {
	const handle = await open(abs, "r").catch(() => null);
	if (!handle) return null;
	try {
		const info = await handle.stat();
		if (!info.isFile()) return null;
		const length = Math.min(info.size, bytes);
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, 0);
		return {
			text: buffer.subarray(0, bytesRead).toString("utf8"),
			size: info.size,
		};
	} finally {
		await handle.close();
	}
}

/** The first `bytes` of a text, cut at a character, and the size of the whole. */
export function cutText(
	text: string,
	bytes: number,
): { text: string; size: number } {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.length <= bytes) return { text, size: buffer.length };
	// A cut inside a character drops that character.
	const cut = buffer
		.subarray(0, bytes)
		.toString("utf8")
		.replace(/\uFFFD$/, "");
	return { text: cut, size: buffer.length };
}

/**
 * A path as a person or an agent gave it (`./` in front, spaces around),
 * or null when it is not one they read (`isReadable`).
 */
export function cleanPath(path: string): string | null {
	const clean = path.trim().replace(/^\.\/+/, "");
	return isReadable(clean) ? clean : null;
}

/** A PDF or Word file's text as `read` gives it, or a Refusal when it gives none. */
function documentResult(
	path: string,
	docs: Document<DocumentMetadata>[] | null,
	maxBytes: number,
	from?: KnowledgeReadFrom,
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
	const text = textOf(docs);
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
	from: KnowledgeReadFrom | undefined,
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
	from: KnowledgeReadFrom | undefined,
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
function documentPages(docs: Document<DocumentMetadata>[]): TextPage[] {
	return docs.map((doc, i) => ({
		text: doc.pageContent.replace(/\r\n?/g, "\n"),
		page: doc.metadata.loc?.pageNumber ?? (docs.length > 1 ? i + 1 : null),
	}));
}

/** A file's first bytes as `read` gives them, or a Refusal when they are not text. */
function textResult(
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
function textResultFrom(
	path: string,
	whole: string,
	size: number,
	maxBytes: number,
	from: KnowledgeReadFrom | undefined,
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
function tooLarge(path: string): Refusal {
	return new Refusal(
		"unavailable",
		`"${path}" is larger than 10 MB. Night Shift does not read its text.`,
	);
}

/**
 * One file of the knowledge folder `dir`, by its path, at most `maxBytes`
 * of its text: a PDF or Word file's text, any other file's first bytes.
 * Null when the folder has no such file, or the path is not one a person
 * or an agent reads, or a link leads it out of the folder. Refuses a file
 * that is not text and a document whose text it cannot read.
 */
export async function readFolderFile(
	dir: string,
	path: string,
	maxBytes: number,
	from?: KnowledgeReadFrom,
): Promise<KnowledgeText | null> {
	const clean = cleanPath(path);
	if (clean === null) return null;
	const abs = join(dir, ...clean.split("/"));
	const info = await lstat(abs).catch(() => null);
	if (!info?.isFile()) return null;
	const [real, base] = await Promise.all([
		realpath(abs).catch(() => ""),
		realpath(dir).catch(() => ""),
	]);
	if (base === "" || !real.startsWith(`${base}/`)) return null;
	const bytes = Math.max(1, maxBytes);
	if (isDocument(clean)) {
		if (info.size > LOCAL_ONLY_BYTES) throw tooLarge(clean);
		return documentResult(clean, await loadDocument(abs), bytes, from);
	}
	if (from) {
		const whole = await readStart(abs, LOCAL_ONLY_BYTES);
		if (!whole) return null;
		return textResultFrom(clean, whole.text, whole.size, bytes, from);
	}
	const read = await readStart(abs, bytes);
	if (!read) return null;
	return textResult(clean, read.text, read.size, bytes);
}

/**
 * A file of the knowledge from its content, as `readFolderFile` reads it:
 * for a Device that has the file by its hash only. Null for a path a
 * person or an agent does not read.
 */
export async function knowledgeText(
	path: string,
	content: Uint8Array,
	maxBytes: number,
	from?: KnowledgeReadFrom,
): Promise<KnowledgeText | null> {
	const clean = cleanPath(path);
	if (clean === null) return null;
	const bytes = Math.max(1, maxBytes);
	if (isDocument(clean)) {
		if (content.length > LOCAL_ONLY_BYTES) throw tooLarge(clean);
		return documentResult(
			clean,
			await loadDocumentContent(clean, content),
			bytes,
			from,
		);
	}
	if (from) {
		const whole = Buffer.from(content.subarray(0, LOCAL_ONLY_BYTES)).toString(
			"utf8",
		);
		return textResultFrom(clean, whole, content.length, bytes, from);
	}
	const start = Buffer.from(content.subarray(0, bytes)).toString("utf8");
	return textResult(clean, start, content.length, bytes);
}
