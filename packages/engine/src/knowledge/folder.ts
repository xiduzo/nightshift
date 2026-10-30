import { randomUUID } from "node:crypto";
import {
	appendFile,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, extname, join } from "node:path";

/**
 * The knowledge folder of a project: markdown (and any other files) that
 * an agent may read, kept outside the repository and outside every
 * worktree: `<dataDir>/knowledge/<projectId>/`. Each Device has its own.
 *
 * Sync flows fill it with Commands (the `knowledge/*` kits), through the
 * folder the step gets in `NS_KNOWLEDGE`. Night Shift writes `INDEX.md`
 * at its top itself: one line per file, with its path, title, first
 * sentence and when it last changed. It writes it again when it is stale
 * (a file is newer than it, or a file came or went) at the moment an agent
 * gets the folder and when the Knowledge page reads it. Nothing loads the
 * files into a prompt: the agent reads `INDEX.md`, then greps.
 *
 * `learnings/` is Night Shift's own: what agents proposed to learn wait in
 * `learnings/proposed/` until a person accepts them into
 * `learnings/accepted/`. The index lists the accepted ones only.
 */

/** One file of the folder, as the index and the Knowledge page list it. */
export type KnowledgeFile = {
	/** Relative to the folder, with `/` between its parts. */
	path: string;
	/** Bytes. */
	size: number;
	/** Epoch ms. */
	changedAt: number;
};

/**
 * Past this many files, the folder is too large to read well: the
 * Knowledge page warns, and a search index (phase 2) would pay off.
 */
export const KNOWLEDGE_FILES_WARNING = 2000;

/** The file Night Shift writes at the top of the folder. */
export const INDEX_FILE = "INDEX.md";
/** The proposals that wait for a person: never in the index. */
const PROPOSED_DIR = "learnings/proposed";
/** The most files the index lists: a folder past it is far too large to read. */
const MAX_FILES = 20_000;
/** What the index reads of a file for its title and first sentence. */
const HEAD_BYTES = 4096;
/** The files whose text the index reads. Any other file shows its name only. */
export const TEXT_FILES = new Set([".md", ".markdown", ".mdx", ".txt", ".rst"]);

/** An id as one file or folder name: nothing that could leave the folder. */
function folderName(id: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
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
		/**
		 * Adds what an agent of the run proposes to learn to
		 * `learnings/proposed/<runId>.md`, one note per line, for a person
		 * to accept or reject (`kit:knowledge/review-learnings`).
		 */
		async propose(
			projectId: string,
			runId: string,
			notes: readonly string[],
		): Promise<void> {
			const lines = notes
				.map((note) => note.replace(/\s+/g, " ").trim())
				.filter((note) => note !== "");
			if (lines.length === 0) return;
			const dir = join(folder(projectId), PROPOSED_DIR);
			await mkdir(dir, { recursive: true });
			const file = join(dir, `${folderName(runId)}.md`);
			const isNew = (await stat(file).catch(() => null)) === null;
			const head = isNew
				? `# Learnings of run ${runId.slice(0, 8)}\n\nWhat the agents of run ${runId} proposed to learn about this project.\n\n`
				: "";
			await appendFile(
				file,
				`${head}${lines.map((line) => `- ${line}`).join("\n")}\n`,
			);
		},
		/** How many notes wait for a person in `learnings/proposed/`. */
		async proposed(projectId: string): Promise<number> {
			const dir = join(folder(projectId), PROPOSED_DIR);
			const names = await readdir(dir).catch(() => [] as string[]);
			let count = 0;
			for (const name of names) {
				if (!name.endsWith(".md")) continue;
				const text = await readFile(join(dir, name), "utf8").catch(() => "");
				count += text
					.split("\n")
					.filter((line) => line.startsWith("- ")).length;
			}
			return count;
		},
		/** The files of the folder, the index left out, by path. None when it is not there. */
		files: async (projectId: string) => (await walk(folder(projectId))).files,
		/**
		 * The index of the folder, written again when it is stale. Returns
		 * the files it lists. A folder that is not there is made.
		 */
		async index(projectId: string): Promise<KnowledgeFile[]> {
			const path = await ensure(projectId);
			const { files, newest } = await walk(path);
			const indexPath = join(path, INDEX_FILE);
			const written = await stat(indexPath).catch(() => null);
			const stale =
				written === null ||
				newest > written.mtimeMs ||
				!samePaths(
					indexedPaths(await readFile(indexPath, "utf8").catch(() => "")),
					files,
				);
			if (stale) await writeAtomic(indexPath, await indexText(path, files));
			return files;
		},
	};
}

/**
 * Every file under `dir` but the index, hidden ones (`.git`), links and
 * the proposals, sorted by path; and the newest change among them and
 * their folders.
 */
async function walk(
	dir: string,
): Promise<{ files: KnowledgeFile[]; newest: number }> {
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
			if (files.length >= MAX_FILES) return;
			if (name.startsWith(".")) continue;
			const path = rel === "" ? name : `${rel}/${name}`;
			if (path === INDEX_FILE || path === PROPOSED_DIR) continue;
			const info = await lstat(join(abs, name)).catch(() => null);
			if (!info) continue;
			if (info.isDirectory()) {
				// A file that went changes its folder.
				newest = Math.max(newest, info.mtimeMs);
				await visit(join(abs, name), path);
			} else if (info.isFile()) {
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
				file.path,
			);
			const day = new Date(file.changedAt).toISOString().slice(0, 10);
			return `- \`${file.path}\`: ${title}${sentence ? `. ${sentence}` : ""} (changed ${day})`;
		}),
	);
	return [
		"# Knowledge index",
		"",
		"Night Shift writes this file. One line per file: its path, title, first sentence and the day it last changed. Read a file, or grep the folder, for more.",
		"",
		...(lines.length > 0 ? lines : ["No files yet."]),
		"",
	].join("\n");
}

/** A file's title and first sentence, from its first bytes. */
async function describe(
	abs: string,
	path: string,
): Promise<{ title: string; sentence: string }> {
	const name = path.split("/").at(-1) ?? path;
	const fallback = name.slice(0, name.length - extname(name).length) || name;
	if (!TEXT_FILES.has(extname(name).toLowerCase())) {
		return { title: name, sentence: "" };
	}
	const head = await readHead(abs);
	return describeText(head, fallback);
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

async function readHead(path: string): Promise<string> {
	const handle = await open(path, "r").catch(() => null);
	if (!handle) return "";
	try {
		const buffer = Buffer.alloc(HEAD_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
		return buffer.subarray(0, bytesRead).toString("utf8");
	} finally {
		await handle.close();
	}
}

/** Writes the file whole or not at all: a reader never sees half an index. */
async function writeAtomic(path: string, text: string): Promise<void> {
	// Hidden, so a walk at the same time skips it.
	const temp = join(dirname(path), `.${INDEX_FILE}.${randomUUID()}.tmp`);
	await writeFile(temp, text);
	await rename(temp, path);
}
