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
import { tinyDocx, tinyPdf } from "../testing/documents";
import {
	createKnowledgeFolders,
	describeDocumentText,
	describeText,
	textFrom,
} from "./folder";

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

describe("PDF and Word files in the index", () => {
	test("show the title and first sentence of their text", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		await writeFile(
			join(dir, "release.pdf"),
			tinyPdf(["Release checklist", "We ship on Fridays. Then we rest."]),
		);
		await writeFile(
			join(dir, "guide.docx"),
			tinyDocx("Onboarding guide", ["Every new teammate meets the wombat."]),
		);
		await folders.index("p1");
		const index = await readFile(join(dir, "INDEX.md"), "utf8");
		expect(index).toContain(
			"- `guide.docx`: Onboarding guide. Every new teammate meets the wombat",
		);
		expect(index).toContain(
			"- `release.pdf`: Release checklist. We ship on Fridays (",
		);
	});

	test("an index of an older Night Shift is written again", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		await put(dir, "a.md", "# A\n");
		await folders.index("p1");
		await writeFile(
			join(dir, "INDEX.md"),
			"# Knowledge index\n\n- `a.md`: A\n",
		);
		await folders.index("p1");
		expect(await readFile(join(dir, "INDEX.md"), "utf8")).toContain(
			"PDF and Word files too",
		);
	});

	test("a PDF's own title comes first, unless a program made it up", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		await writeFile(
			join(dir, "plan.pdf"),
			tinyPdf(["We go on Monday. Then we rest."], { title: "Team plan" }),
		);
		await writeFile(
			join(dir, "export.pdf"),
			tinyPdf(["Exported notes", "We keep it short."], {
				title: "Microsoft Word - notes.docx",
			}),
		);
		await folders.index("p1");
		const index = await readFile(join(dir, "INDEX.md"), "utf8");
		expect(index).toContain("- `plan.pdf`: Team plan. We go on Monday (");
		expect(index).toContain(
			"- `export.pdf`: Exported notes. We keep it short (",
		);
	});

	test("the first short line without a stop is the title, else the file name", () => {
		expect(describeDocumentText("Plan\nWe go. Later more.", "f")).toEqual({
			title: "Plan",
			sentence: "We go",
		});
		expect(describeDocumentText("This is a sentence.\nMore.", "f")).toEqual({
			title: "f",
			sentence: "This is a sentence",
		});
		expect(describeDocumentText("", "f")).toEqual({ title: "f", sentence: "" });
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

describe("a read from a spot", () => {
	const doc = [
		"# Guide",
		"",
		"Intro.",
		"",
		"## Rolling updates",
		"",
		"Stop the old one first.",
		"",
		"## Backups",
		"",
		"Every night.",
	].join("\n");

	test("starts at a section's heading, a line, or the first line with the section's words", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		await put(dir, "wiki/guide.md", doc);
		const section = await folders.read("p1", "wiki/guide.md", 1024, {
			section: "rolling updates",
		});
		expect(section).toMatchObject({
			title: "Guide",
			text: "## Rolling updates\n\nStop the old one first.\n\n## Backups\n\nEvery night.",
			from: { line: 5, page: null },
			size: Buffer.byteLength(doc),
			truncated: false,
		});
		const line = await folders.read("p1", "wiki/guide.md", 12, { line: 9 });
		expect(line).toMatchObject({
			text: "## Backups\n\n",
			from: { line: 9, page: null },
			truncated: true,
		});
		expect(
			(await folders.read("p1", "wiki/guide.md", 1024, { section: "night" }))
				?.from,
		).toEqual({ line: 11, page: null });
		// A section it does not have: the start, without a spot.
		const missing = await folders.read("p1", "wiki/guide.md", 7, {
			section: "Releases",
		});
		expect(missing).toMatchObject({ text: "# Guide", truncated: true });
		expect(missing?.from).toBeUndefined();
	});

	test("on pages, a line counts in its page, and a section is looked for from that page on", () => {
		const pages = [
			{ text: "Cover\nRollout", page: 1 },
			{ text: "Intro\n# Rollout\nSteps", page: 2 },
		];
		expect(textFrom(pages, { page: 2, line: 2 })).toEqual({
			text: "# Rollout\nSteps",
			line: 2,
			page: 2,
		});
		expect(textFrom(pages, { section: "Rollout" })).toMatchObject({
			line: 2,
			page: 2,
		});
		expect(textFrom(pages, { page: 1 })?.text).toBe(
			"Cover\nRollout\n\nIntro\n# Rollout\nSteps",
		);
		expect(textFrom(pages, { page: 3 })).toBeNull();
		expect(textFrom(pages, {})).toBeNull();
	});
});
