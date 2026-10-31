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
import { Refusal } from "@nightshift/refusal";
import { writeWhole } from "../archive";
import {
	type DocumentMetadata,
	isDocument,
	LOCAL_ONLY_BYTES,
	loadDocument,
	loadDocumentContent,
	textOf,
} from "./documents";
import { isProposal } from "./learnings";

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
 * `learnings/` is Night Shift's own (`learnings.ts`): the index lists the
 * learnings a person kept, never the proposals that wait.
 *
 * Which files count, and how one is read, is decided here once: the
 * reconcile, `INDEX.md`, the search index and every read take the same
 * walk (`walkFolder`), the same rules (`isKnowledgePath`, `isReadable`) and
 * the same read (`readFolderFile`, `knowledgeText`).
 */

/** One file of the knowledge, as the index and the Knowledge page list it. */
export type KnowledgeFile = {
	/** Relative to the folder, with `/` between its parts. */
	path: string;
	/** Bytes. */
	size: number;
	/** Epoch ms. */
	changedAt: number;
	/** Larger than 10 MB: it stays on the Device that has it. */
	local?: true;
};

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
};

/** The file Night Shift writes at the top of the folder. */
export const INDEX_FILE = "INDEX.md";
/**
 * What the sync kits name a file or folder while they write it, before a
 * rename makes it whole (`$dest.part`, `page.md.part`): never knowledge.
 */
const STAGING_SUFFIX = ".part";
/** The longest path the knowledge takes. */
const MAX_PATH = 1024;
/** The most files the index lists: a folder past it is far too large to read. */
const MAX_FILES = 20_000;
/** What the index reads of a file for its title and first sentence. */
const HEAD_BYTES = 4096;
/** The files whose text the index reads, besides PDF and Word files. Any other file shows its name only. */
export const TEXT_FILES = new Set([".md", ".markdown", ".mdx", ".txt", ".rst"]);
/** The first line of the index's text: an index without it is written again. */
const INDEX_INTRO =
	"Night Shift writes this file. One line per file: its path, title, first sentence and the day it last changed. PDF and Word files too. Read a file, or grep the folder, for more.";

/**
 * Whether a path is one of the knowledge, in the folder and in the
 * Space's document: relative, with `/` between its parts, none of them
 * empty, `.`, `..` or hidden, none a file or folder a sync kit still
 * writes (`*.part`), and not the index Night Shift writes. A path another
 * Device wrote that is not one is left out: it never leaves the folder.
 */
export function isKnowledgePath(path: string): boolean {
	if (path === "" || path.length > MAX_PATH) return false;
	// Not even in another case: on macOS, `index.md` is the index.
	if (path.toLowerCase() === INDEX_FILE.toLowerCase()) return false;
	if (/[\\\0]/.test(path)) return false;
	return path
		.split("/")
		.every(
			(part) =>
				part !== "" && !part.startsWith(".") && !part.endsWith(STAGING_SUFFIX),
		);
}

/**
 * Whether a person or an agent reads a path: one of the knowledge, but no
 * proposal. The index, search and `read_knowledge` take these only.
 */
export function isReadable(path: string): boolean {
	return isKnowledgePath(path) && !isProposal(path);
}

/** A file's title when its text gives none: its name without the extension. */
export function fallbackTitle(path: string): string {
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
		/**
		 * The files a person or an agent reads (`isReadable`), by path, at
		 * most 20 000. None when the folder is not there.
		 */
		files: async (projectId: string) =>
			(await walkFolder(folder(projectId), readable)).files,
		/**
		 * One file of the folder, by its path, at most `maxBytes` of its
		 * text (`readFolderFile`). Null when the folder has no such file.
		 */
		read: (projectId: string, path: string, maxBytes: number) =>
			readFolderFile(folder(projectId), path, maxBytes),
		/**
		 * The index of the folder, written again when it is stale. Returns
		 * the files it lists. A folder that is not there is made.
		 */
		async index(projectId: string): Promise<KnowledgeFile[]> {
			const path = await ensure(projectId);
			const { files, newest } = await walkFolder(path, readable);
			const indexPath = join(path, INDEX_FILE);
			const written = await stat(indexPath).catch(() => null);
			const text =
				written === null
					? ""
					: await readFile(indexPath, "utf8").catch(() => "");
			const stale =
				written === null ||
				newest > written.mtimeMs ||
				!text.includes(INDEX_INTRO) ||
				!samePaths(indexedPaths(text), files);
			if (stale) await writeWhole(indexPath, await indexText(path, files));
			return files;
		},
	};
}

/** What a person or an agent reads, at most 20 000 files. */
const readable = { only: isReadable, limit: MAX_FILES };

/**
 * Every file of the knowledge under `dir` (`isKnowledgePath`), no link,
 * sorted by path; and the newest change among them and their folders.
 * `only` leaves out more, `limit` stops the walk.
 */
export async function walkFolder(
	dir: string,
	options: { only?: (path: string) => boolean; limit?: number } = {},
): Promise<{ files: KnowledgeFile[]; newest: number }> {
	const only = options.only ?? isKnowledgePath;
	const limit = options.limit ?? Number.POSITIVE_INFINITY;
	const files: KnowledgeFile[] = [];
	let newest = 0;
	const visit = async (abs: string, rel: string): Promise<void> => {
		let entries: string[];
		try {
			entries = await readdir(abs);
		} catch {
			return;
		}
		for (const name of entries.sort()) {
			if (files.length >= limit) return;
			const path = rel === "" ? name : `${rel}/${name}`;
			const info = await lstat(join(abs, name)).catch(() => null);
			if (!info) continue;
			if (info.isDirectory()) {
				// A folder whose files would all be left out is not walked.
				if (!only(`${path}/x`)) continue;
				// A file that went changes its folder.
				newest = Math.max(newest, info.mtimeMs);
				await visit(join(abs, name), path);
			} else if (info.isFile() && only(path)) {
				newest = Math.max(newest, info.mtimeMs);
				files.push({ path, size: info.size, changedAt: info.mtimeMs });
			}
		}
	};
	await visit(dir, "");
	return { files, newest };
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
	const lines = await Promise.all(
		files.map(async (file) => {
			const { title, sentence } = await describe(
				join(dir, ...file.path.split("/")),
				file,
			);
			const day = new Date(file.changedAt).toISOString().slice(0, 10);
			return `- \`${file.path}\`: ${title}${sentence ? `. ${sentence}` : ""} (changed ${day})`;
		}),
	);
	return [
		"# Knowledge index",
		"",
		INDEX_INTRO,
		"",
		...(lines.length > 0 ? lines : ["No files yet."]),
		"",
	].join("\n");
}

type Description = { title: string; sentence: string };

/** Whether the text of a file is read for its title: a text file. */
const isText = (path: string) => TEXT_FILES.has(extname(path).toLowerCase());

/** A file's title and first sentence: from its first bytes, or a document's text. */
async function describe(
	abs: string,
	file: KnowledgeFile,
): Promise<Description> {
	const name = file.path.split("/").at(-1) ?? file.path;
	if (isDocument(name)) {
		const docs = await loadDocument(abs);
		return docs === null
			? { title: name, sentence: "" }
			: describeDocument(docs, fallbackTitle(name));
	}
	if (!isText(name)) return { title: name, sentence: "" };
	const head = await readStart(abs, HEAD_BYTES);
	return describeText(head?.text ?? "", fallbackTitle(name));
}

/**
 * The title and first sentence of a document's text: its first line is
 * the title when it is short and ends without a stop, else the file name.
 */
export function describeDocumentText(
	text: string,
	fallback: string,
): Description {
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
export function describeDocument(
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
export function describeText(
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
function cleanPath(path: string): string | null {
	const clean = path.trim().replace(/^\.\/+/, "");
	return isReadable(clean) ? clean : null;
}

/** A PDF or Word file's text as `read` gives it, or a Refusal when it gives none. */
function documentResult(
	path: string,
	docs: Document<DocumentMetadata>[] | null,
	maxBytes: number,
): KnowledgeText {
	if (docs === null) {
		throw new Refusal(
			"invalid",
			`Night Shift cannot read the text of "${path}".`,
		);
	}
	const text = textOf(docs);
	const cut = cutText(text, maxBytes);
	return {
		path,
		title: describeDocument(docs, fallbackTitle(path)).title,
		text: cut.text,
		size: cut.size,
		truncated: cut.size > maxBytes,
	};
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
	const name = path.split("/").at(-1) ?? path;
	return {
		path,
		title: isText(path)
			? describeText(text.slice(0, HEAD_BYTES), fallbackTitle(path)).title
			: name,
		text,
		size,
		truncated: size > maxBytes,
	};
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
		return documentResult(clean, await loadDocument(abs), bytes);
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
		);
	}
	const start = Buffer.from(content.subarray(0, bytes)).toString("utf8");
	return textResult(clean, start, content.length, bytes);
}
