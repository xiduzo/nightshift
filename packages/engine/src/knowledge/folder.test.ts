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
import { Document } from "@langchain/core/documents";
import { asDate, iso, now } from "@nightshift/time";
import { tinyDocx, tinyPdf } from "../testing/documents";
import type { DocumentMetadata } from "./documents";
import {
	createKnowledgeFolders,
	describeFile,
	indexFolder,
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

/** Writes the index of p1 when it is stale, from a new look at its folder. */
const writeIndex = async () =>
	indexFolder(await createKnowledgeFolders(dataDir).scan("p1"));

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
		// A git source keeps its clone in its folder: it stays out too.
		await put(dir, "repo/.git/objects/pack/a.pack", "x");
		await put(dir, "INDEX.md", "old");
		await put(dir, "learnings/proposed/r1.md", "- a note");
		await put(dir, "learnings/accepted/r0.md", "- kept");
		const { readable: files } = await folders.scan("p1");
		expect(files.map((f) => f.path)).toEqual([
			"learnings/accepted/r0.md",
			"wiki/Home.md",
		]);
		expect(files[1]?.size).toBe(7);
		expect((await folders.scan("none")).readable).toEqual([]);
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
		const day = iso(now()).slice(0, 10);
		await writeIndex();
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
		const past = asDate(now() - 60_000);
		await utimes(join(dir, "wiki/Home.md"), past, past);
		await utimes(join(dir, "wiki"), past, past);
		await utimes(join(dir, "notes.txt"), past, past);
		await utimes(join(dir, "diagram.png"), past, past);
		await writeIndex();
		expect(await readFile(index, "utf8")).toContain("<!-- kept -->");

		// A file that went: written again.
		await rm(join(dir, "diagram.png"));
		await writeIndex();
		const second = await readFile(index, "utf8");
		expect(second).not.toContain("<!-- kept -->");
		expect(second).not.toContain("diagram.png");

		// A file that changed: written again.
		await writeFile(index, `${second}<!-- kept -->\n`);
		const old = asDate(now() - 30_000);
		await utimes(index, old, old);
		await put(dir, "notes.txt", "New words.\n");
		await writeIndex();
		expect(await readFile(index, "utf8")).toContain("New words");
	});

	test("an empty folder says so", async () => {
		const folders = createKnowledgeFolders(dataDir);
		await writeIndex();
		expect(
			await readFile(join(folders.folder("p1"), "INDEX.md"), "utf8"),
		).toContain("No files yet.");
	});
});

describe("the headings in the index", () => {
	const indexOf = async (files: Record<string, string>) => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		for (const [path, text] of Object.entries(files)) {
			await put(dir, path, text);
		}
		await writeIndex();
		return (await readFile(join(dir, "INDEX.md"), "utf8")).split("\n");
	};
	/** The line under the line of a file: its headings. Undefined: it has none. */
	const under = (lines: string[], path: string) => {
		const next = lines[lines.findIndex((l) => l.includes(`\`${path}\``)) + 1];
		return next?.startsWith("  ") ? next.trim() : undefined;
	};

	test("come under the line of the file, without the title, not from code or front matter", async () => {
		const lines = await indexOf({
			"guide.md": [
				"---",
				"# a comment",
				"title: Guide",
				"---",
				"# Guide",
				"",
				"The first sentence.",
				"",
				"## Install",
				"",
				"```sh",
				"# not a heading",
				"```",
				"",
				"### From source",
				"",
				"## `Run` it",
			].join("\n"),
			"plain.md": "# Plain\n\nOnly a title.\n",
			"notes.txt": "# Not markdown\n\n## Not a heading here\n",
		});
		expect(under(lines, "guide.md")).toBe("Install · From source · 'Run' it");
		expect(under(lines, "plain.md")).toBeUndefined();
		expect(under(lines, "notes.txt")).toBeUndefined();
	});

	test("show deeper levels only when the whole level fits", async () => {
		const many = (mark: string, n: number) =>
			Array.from({ length: n }, (_, i) => `${mark} ${mark.length}.${i}`);
		const lines = await indexOf({
			"fits.md": ["# Title", ...many("##", 3), ...many("###", 4)].join("\n\n"),
			"deep.md": ["# Title", ...many("##", 3), ...many("###", 20)].join("\n\n"),
		});
		expect(under(lines, "fits.md")?.split(" · ")).toHaveLength(7);
		expect(under(lines, "deep.md")).toBe("2.0 · 2.1 · 2.2");
	});

	test("stop at their limits: 200 headings, and very long ones", async () => {
		const lines = await indexOf({
			"many.md": [
				"# Title",
				...Array.from({ length: 200 }, (_, i) => `## Part ${i}`),
			].join("\n\n"),
			"long.md": [
				"# Title",
				...Array.from({ length: 10 }, (_, i) => `## ${i} ${"x".repeat(500)}`),
			].join("\n\n"),
		});
		const many = under(lines, "many.md") ?? "";
		expect(many.split(" · ")).toHaveLength(13);
		expect(many).toEndWith("Part 11 · … 188 more");
		const long = under(lines, "long.md") ?? "";
		expect(long).toEndWith("… 7 more");
		expect(long.length).toBeLessThanOrEqual(320);
	});

	test("show for the largest files only, so a folder of thousands stays short", async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 150; i++) {
			// The larger the number, the larger the file.
			const name = String(i).padStart(3, "0");
			files[`f${name}.md`] =
				`# F${name}\n\n## Part\n\n${"word ".repeat(10 + i)}\n`;
		}
		const lines = await indexOf(files);
		const outlines = lines.filter((line) => line.startsWith("  "));
		expect(outlines).toHaveLength(100);
		expect(under(lines, "f149.md")).toBe("Part");
		expect(under(lines, "f050.md")).toBe("Part");
		expect(under(lines, "f049.md")).toBeUndefined();
		// Still one listed path per file: the headings are not read as files.
		const stale = lines.filter((line) => line.startsWith("- `"));
		expect(stale).toHaveLength(150);
	});

	test("say that more may follow when a file is too long to read to its end", async () => {
		const part = `${"word ".repeat(200)}\n\n`;
		const lines = await indexOf({
			"huge.md": `# Huge\n\n## Start\n\n${part.repeat(300)}## Far away\n`,
		});
		expect(under(lines, "huge.md")).toBe("Start · …");
	});

	test("do not make the index stale", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		await put(dir, "a.md", "# A\n\n## One\n\n## Two\n");
		await writeIndex();
		const index = join(dir, "INDEX.md");
		const first = await readFile(index, "utf8");
		await writeFile(index, `${first}<!-- kept -->\n`);
		const past = asDate(now() - 60_000);
		await utimes(join(dir, "a.md"), past, past);
		await writeIndex();
		expect(await readFile(index, "utf8")).toContain("<!-- kept -->");
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
		await writeIndex();
		const index = await readFile(join(dir, "INDEX.md"), "utf8");
		expect(index).toContain(
			"- `guide.docx`: Onboarding guide. Every new teammate meets the wombat",
		);
		// No headings: nothing more to parse at a step's start.
		expect(index.split("\n").filter((l) => l.startsWith("  "))).toEqual([]);
		expect(index).toContain(
			"- `release.pdf`: Release checklist. We ship on Fridays (",
		);
	});

	test("an index of an older Night Shift is written again", async () => {
		const folders = createKnowledgeFolders(dataDir);
		const dir = await folders.ensure("p1");
		await put(dir, "a.md", "# A\n");
		await writeIndex();
		await writeFile(
			join(dir, "INDEX.md"),
			"# Knowledge index\n\n- `a.md`: A\n",
		);
		await writeIndex();
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
		await writeIndex();
		const index = await readFile(join(dir, "INDEX.md"), "utf8");
		expect(index).toContain("- `plan.pdf`: Team plan. We go on Monday (");
		expect(index).toContain(
			"- `export.pdf`: Exported notes. We keep it short (",
		);
	});

	test("the first short line without a stop is the title, else the file name", () => {
		const ofText = (text: string) =>
			describeFile("dir/f.pdf", {
				docs: [
					new Document<DocumentMetadata>({
						pageContent: text,
						metadata: { source: "f" },
					}),
				],
			});
		expect(ofText("Plan\nWe go. Later more.")).toEqual({
			title: "Plan",
			sentence: "We go",
		});
		expect(ofText("This is a sentence.\nMore.")).toEqual({
			title: "f",
			sentence: "This is a sentence",
		});
		expect(ofText("")).toEqual({ title: "f", sentence: "" });
	});

	test("one that does not open shows its name", () => {
		expect(describeFile("dir/f.pdf", { docs: null })).toEqual({
			title: "f.pdf",
			sentence: "",
		});
	});
});

describe("the title of a file", () => {
	const ofText = (text: string) => describeFile("dir/file.md", { text });

	test("is the first heading, with the first sentence, past code and quotes", () => {
		expect(
			ofText("Intro line first. More.\n\n```\ncode\n```\n> quote\n## Title\n"),
		).toEqual({ title: "Title", sentence: "Intro line first" });
		expect(ofText("")).toEqual({ title: "file", sentence: "" });
		expect(ofText("- a list item. Then.").sentence).toBe("a list item");
	});

	test("of a file that is not text is its name, whatever its bytes say", () => {
		expect(describeFile("dir/a.png", { text: "# Not a title" })).toEqual({
			title: "a.png",
			sentence: "",
		});
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
