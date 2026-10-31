import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tinyDocx, tinyPdf } from "../testing/documents";
import { documentText, loadDocument } from "./documents";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ns-documents-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
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
		expect(await documentText(abs)).toBe(
			"Onboarding guide\n\nEvery new teammate meets the wombat.",
		);
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
