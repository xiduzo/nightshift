import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKnowledgeFolders, describeText } from "./folder";
import { KNOWLEDGE_ENV, sessionKnowledge } from "./handoff";

let dataDir: string;
beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-knowledge-"));
});
afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

const put = async (dir: string, path: string, text: string) => {
	await mkdir(join(dir, path, ".."), { recursive: true });
	await writeFile(join(dir, path), text);
};

describe("the knowledge folder", () => {
	test("is per project, under the data folder, and refuses an id that leaves it", () => {
		const folders = createKnowledgeFolders(dataDir);
		expect(folders.folder("p1")).toBe(join(dataDir, "knowledge", "p1"));
		expect(() => folders.folder("../p1")).toThrow();
		expect(() => folders.folder("a/b")).toThrow();
	});

	test("lists its files, but not the index, hidden files or the proposals", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		await put(dir, "wiki/Home.md", "# Home\n");
		await put(dir, ".git/HEAD", "x");
		await put(dir, "INDEX.md", "old");
		await put(dir, "learnings/proposed/r1.md", "- a note");
		await put(dir, "learnings/accepted/r0.md", "- kept");
		const files = await folders.files("p1");
		expect(files.map((f) => f.path)).toEqual([
			"learnings/accepted/r0.md",
			"wiki/Home.md",
		]);
		expect(files[1]?.size).toBe(7);
		expect(await folders.files("none")).toEqual([]);
	});

	test("writes the index with one line per file, and again only when it is stale", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		await put(
			dir,
			"wiki/Home.md",
			"---\ntitle: Home page\n---\n# Welcome\n\nThe wiki of the project. It has more.\n",
		);
		await put(dir, "notes.txt", "Plain words here.\n");
		await put(dir, "diagram.png", "png");
		const day = new Date().toISOString().slice(0, 10);
		await folders.index("p1");
		const index = join(dir, "INDEX.md");
		const first = await readFile(index, "utf8");
		expect(first).toContain(
			`- \`wiki/Home.md\`: Home page. The wiki of the project (changed ${day})`,
		);
		expect(first).toContain(
			`- \`notes.txt\`: notes. Plain words here (changed ${day})`,
		);
		expect(first).toContain(`- \`diagram.png\`: diagram.png (changed ${day})`);

		// Not stale: the index stays as it is.
		await writeFile(index, `${first}<!-- kept -->\n`);
		const past = new Date(Date.now() - 60_000);
		await utimes(join(dir, "wiki/Home.md"), past, past);
		await utimes(join(dir, "wiki"), past, past);
		await utimes(join(dir, "notes.txt"), past, past);
		await utimes(join(dir, "diagram.png"), past, past);
		await folders.index("p1");
		expect(await readFile(index, "utf8")).toContain("<!-- kept -->");

		// A file that went: written again.
		await rm(join(dir, "diagram.png"));
		await folders.index("p1");
		const second = await readFile(index, "utf8");
		expect(second).not.toContain("<!-- kept -->");
		expect(second).not.toContain("diagram.png");

		// A file that changed: written again.
		await writeFile(index, `${second}<!-- kept -->\n`);
		const old = new Date(Date.now() - 30_000);
		await utimes(index, old, old);
		await put(dir, "notes.txt", "New words.\n");
		await folders.index("p1");
		expect(await readFile(index, "utf8")).toContain("New words");
	});

	test("an empty folder says so", async () => {
		const folders = createKnowledgeFolders(dataDir);
		await folders.index("p1");
		expect(
			await readFile(join(folders.folder("p1"), "INDEX.md"), "utf8"),
		).toContain("No files yet.");
	});
});

describe("describeText", () => {
	test("the first heading and the first sentence, past code and quotes", () => {
		expect(
			describeText(
				"Intro line first. More.\n\n```\ncode\n```\n> quote\n## Title\n",
				"file",
			),
		).toEqual({ title: "Title", sentence: "Intro line first" });
		expect(describeText("", "file")).toEqual({ title: "file", sentence: "" });
		expect(describeText("- a list item. Then.", "f").sentence).toBe(
			"a list item",
		);
	});
});

describe("sessionKnowledge", () => {
	test("an empty folder: only the variable, unless the node asks for it", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const path = folders.folder("p1");
		expect(await sessionKnowledge(folders, { projectId: "p1" })).toEqual({
			env: { [KNOWLEDGE_ENV]: path },
		});
		const always = await sessionKnowledge(folders, {
			projectId: "p1",
			always: true,
		});
		expect(always.addDirs).toEqual([path]);
		expect(always.instructions).toStartWith(`Project knowledge is in ${path}.`);
	});

	test("a folder with files: the folder, the line and a fresh index", async () => {
		const folders = createKnowledgeFolders(dataDir);
		await put(await folders.ensure("p1"), "a.md", "# A\n");
		const given = await sessionKnowledge(folders, { projectId: "p1" });
		expect(given.addDirs).toEqual([folders.folder("p1")]);
		expect(given.instructions).toContain("Read INDEX.md there first");
		expect(
			await readFile(join(folders.folder("p1"), "INDEX.md"), "utf8"),
		).toContain("- `a.md`: A");
	});
});
