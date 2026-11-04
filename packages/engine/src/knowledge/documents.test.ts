import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tinyDocx, tinyPdf } from "../testing/documents";
import { loadDocument, loadDocumentContent, textOf } from "./documents";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ns-documents-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("whose parse goes first", () => {
	/** A PDF long enough to take longer than a one-line one. */
	const long = () =>
		tinyPdf(
			Array.from({ length: 2_000 }, (_, at) => `Line ${at} of the batch.`),
		);

	test("a read waits for the parse that runs, not for the batch behind it", async () => {
		const names = ["a.pdf", "b.pdf", "c.pdf", "d.pdf"];
		for (const name of names) await writeFile(join(dir, name), long());
		await writeFile(join(dir, "asked.pdf"), tinyPdf(["The page reads this."]));

		const done: string[] = [];
		const noted = (name: string, parse: Promise<unknown>) =>
			parse.then(() => done.push(name));
		const batch = names.map((name) =>
			noted(name, loadDocument(join(dir, name))),
		);
		const read = noted(
			"asked.pdf",
			loadDocument(join(dir, "asked.pdf"), "read"),
		);
		await Promise.all([...batch, read]);

		// `a.pdf` was parsing: it ends first, though the read is much shorter. Two
		// parses at once would end the read first, and memory has no bound.
		expect(done).toEqual(["a.pdf", "asked.pdf", "b.pdf", "c.pdf", "d.pdf"]);
	});

	test("a read of a file this Device has by its hash goes first too", async () => {
		const names = ["a.pdf", "b.pdf", "c.pdf"];
		for (const name of names) await writeFile(join(dir, name), long());
		const done: string[] = [];
		const noted = (name: string, parse: Promise<unknown>) =>
			parse.then(() => done.push(name));
		const batch = names.map((name) =>
			noted(name, loadDocument(join(dir, name))),
		);
		const read = noted(
			"asked.pdf",
			loadDocumentContent("asked.pdf", tinyPdf(["By its hash."])),
		);
		await Promise.all([...batch, read]);
		expect(done).toEqual(["a.pdf", "asked.pdf", "b.pdf", "c.pdf"]);
	});

	test("a parse that fails lets the next one run", async () => {
		await writeFile(join(dir, "broken.pdf"), "not a pdf");
		await writeFile(join(dir, "good.pdf"), tinyPdf(["Still here."]));
		const [broken, good] = await Promise.all([
			loadDocument(join(dir, "broken.pdf")),
			loadDocument(join(dir, "good.pdf"), "read"),
		]);
		expect(broken).toBeNull();
		expect(good?.[0]?.pageContent).toBe("Still here.");
	});
});

describe("loadDocument", () => {
	test("a PDF gives a LangChain Document per page, with its file and title", async () => {
		const abs = join(dir, "release.pdf");
		await writeFile(
			abs,
			tinyPdf(["Release checklist", "We ship on Fridays."], {
				title: "Release plan",
			}),
		);
		const docs = await loadDocument(abs);
		expect(docs).toHaveLength(1);
		const [page] = docs ?? [];
		expect(page?.pageContent).toBe("Release checklist\nWe ship on Fridays.");
		expect(page?.metadata.source).toBe(abs);
		expect(page?.metadata.title).toBe("Release plan");
		expect(page?.metadata.loc).toEqual({ pageNumber: 1 });
		expect(page?.metadata.pdf?.totalPages).toBe(1);
		expect(page?.metadata).not.toHaveProperty("blobType");
	});

	test("a Word file gives one Document with its text", async () => {
		const abs = join(dir, "guide.docx");
		await writeFile(
			abs,
			tinyDocx("Onboarding guide", ["Every new teammate meets the wombat."]),
		);
		const docs = await loadDocument(abs);
		expect(docs?.map((doc) => doc.pageContent)).toEqual([
			"Onboarding guide\n\nEvery new teammate meets the wombat.",
		]);
		expect(docs?.[0]?.metadata).toEqual({ source: abs });
		expect(textOf(docs ?? [])).toBe(
			"Onboarding guide\n\nEvery new teammate meets the wombat.",
		);
	});

	test("a file is parsed again when it changes, and a reader's change stays its own", async () => {
		const abs = join(dir, "notes.docx");
		await writeFile(abs, tinyDocx("First", ["One."]));
		const first = await loadDocument(abs);
		if (first?.[0]) first[0].pageContent = "changed by a reader";
		expect((await loadDocument(abs))?.[0]?.pageContent).toBe("First\n\nOne.");
		await writeFile(abs, tinyDocx("Second version", ["Two."]));
		expect(textOf((await loadDocument(abs)) ?? [])).toBe(
			"Second version\n\nTwo.",
		);
	});

	test("a file's content by hash reads as the file does", async () => {
		const content = tinyPdf(["Release checklist"]);
		const abs = join(dir, "release.pdf");
		await writeFile(abs, content);
		const fromFile = await loadDocument(abs);
		const fromContent = await loadDocumentContent("docs/release.pdf", content);
		expect(fromContent?.map((doc) => doc.pageContent)).toEqual(
			fromFile?.map((doc) => doc.pageContent),
		);
		expect(fromContent?.[0]?.metadata.source).toBe("docs/release.pdf");
		expect(
			await loadDocumentContent("notes.md", new TextEncoder().encode("# A")),
		).toBeNull();
	});

	test("null for a file that is missing, broken or not a document", async () => {
		await writeFile(join(dir, "broken.pdf"), "not a pdf");
		await writeFile(join(dir, "broken.docx"), "not a zip");
		await writeFile(join(dir, "notes.md"), "# Notes\n");
		expect(await loadDocument(join(dir, "broken.pdf"))).toBeNull();
		expect(await loadDocument(join(dir, "broken.docx"))).toBeNull();
		expect(await loadDocument(join(dir, "notes.md"))).toBeNull();
		expect(await loadDocument(join(dir, "gone.pdf"))).toBeNull();
	});
});
