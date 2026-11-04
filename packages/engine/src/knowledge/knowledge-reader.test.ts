import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Refusal } from "@nightshift/refusal";
import { tinyDocx, tinyPdf } from "../testing/documents";
import {
	knowledgeDevice as device,
	memoryHost,
	removeKnowledgeDevices,
	syncKnowledgeDocuments as syncDocuments,
} from "../testing/knowledge-devices";

/** What the Knowledge page and the agents read, on a Device that has the files and one that has them by hash. */

afterEach(removeKnowledgeDevices);

describe("listing", () => {
	test("lists the document's files and counts the proposed notes", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.put("logo.png", new Uint8Array([137, 80, 78, 71, 0, 1, 2]));
		await a.learnings.propose("p1", { runId: "run-1" }, [
			"Use bun.",
			"Tests are slow.",
		]);
		await a.sync.reconcile("p1");
		await syncDocuments(a, b);

		const listing = await b.reader.listing("p1");
		expect(listing.files.map((f) => f.path)).toEqual([
			"logo.png",
			"wiki/Home.md",
		]);
		expect(listing.proposed).toBe(2);
		// The sandbox's Space is the personal one of its Person.
		expect(listing.shared).toBe(false);
	});

	// The web editor takes the folders an Agent node may pick from this list,
	// with no filter of its own (`knowledgeFoldersOf`).
	test("leaves out the proposed learnings and the question set, and keeps the accepted learnings", async () => {
		const { host } = memoryHost();
		const a = await device(host);
		await a.put("wiki/Home.md", "# Home\n");
		await a.put("learnings/accepted/run-0.s1.md", "- Kept.\n");
		await a.put("learnings/proposed/run-1.s1.md", "- Waits.\n");
		await a.put("evals/questions.json", "[]\n");

		const { files } = await a.reader.listing("p1");
		expect(files.map((f) => f.path)).toEqual([
			"learnings/accepted/run-0.s1.md",
			"wiki/Home.md",
		]);
	});
});

describe("read", () => {
	/** A's folder has the files, B has them by hash only: both must read alike. */
	async function twoDevices() {
		const { host } = memoryHost();
		const a = await device(host);
		const b = await device(host);
		const both = async () => {
			await a.sync.reconcile("p1");
			await syncDocuments(a, b);
		};
		return { a, b, both };
	}

	test("a file reads the same from this Device's folder and by its hash", async () => {
		const { a, b, both } = await twoDevices();
		await a.put("wiki/a.md", "# Alpha\n\nSome text here.\n");
		await a.put(
			"docs/guide.docx",
			tinyDocx("Onboarding guide", ["Every new teammate meets the wombat."]),
		);
		await a.put(
			"docs/release.pdf",
			tinyPdf(["Release checklist", "We ship on Fridays."]),
		);
		await both();
		expect(await b.has("wiki/a.md")).toBe(false);
		for (const path of ["wiki/a.md", "docs/guide.docx", "docs/release.pdf"]) {
			const here = await a.reader.read("p1", path, 1024);
			expect(await b.reader.read("p1", path, 1024)).toEqual(here);
			expect(await b.reader.read("p1", path, 7)).toEqual(
				await a.reader.read("p1", path, 7),
			);
		}
		expect(await a.reader.read("p1", "./wiki/a.md", 1024)).toEqual({
			path: "wiki/a.md",
			title: "Alpha",
			text: "# Alpha\n\nSome text here.\n",
			size: 25,
			truncated: false,
		});
		expect(await b.reader.read("p1", "wiki/a.md", 7)).toMatchObject({
			text: "# Alpha",
			truncated: true,
		});
		expect(await b.reader.read("p1", "docs/guide.docx", 1024)).toMatchObject({
			title: "Onboarding guide",
			text: "Onboarding guide\n\nEvery new teammate meets the wombat.",
		});
		expect(await b.reader.read("p1", "docs/release.pdf", 1024)).toMatchObject({
			title: "Release checklist",
		});
	});

	test("never a proposal, a hidden file, a link or a path out of the folder: here or by hash", async () => {
		const { a, b, both } = await twoDevices();
		await writeFile(join(a.sandbox.root, "outside.md"), "secret");
		await a.put(".hidden.md", "hidden");
		await a.learnings.propose("p1", { runId: "run-1" }, ["Use bun."]);
		await mkdir(a.dir, { recursive: true });
		await symlink(join(a.sandbox.root, "outside.md"), join(a.dir, "link.md"));
		await both();
		expect((await b.entries()).has("learnings/proposed/run-1.md")).toBe(true);
		for (const device of [a, b]) {
			for (const path of [
				"../outside.md",
				"/etc/hosts",
				"wiki/../../outside.md",
				".hidden.md",
				"learnings/proposed/run-1.md",
				"link.md",
				"missing.md",
				"",
				"wiki",
			]) {
				expect(await device.reader.read("p1", path, 1024)).toBeNull();
			}
		}
	});

	test("refuses a file that is not text, and a document it cannot read: here and by hash", async () => {
		const { a, b, both } = await twoDevices();
		await a.put("logo.png", new Uint8Array([137, 80, 78, 71, 0, 1, 2]));
		await a.put("broken.pdf", "not a pdf");
		await both();
		for (const device of [a, b]) {
			const binary = device.reader.read("p1", "logo.png", 1024);
			await expect(binary).rejects.toBeInstanceOf(Refusal);
			await expect(binary).rejects.toThrow('"logo.png" is not a text file.');
			const broken = device.reader.read("p1", "broken.pdf", 1024);
			await expect(broken).rejects.toBeInstanceOf(Refusal);
			await expect(broken).rejects.toThrow("cannot read the text");
		}
	});
});
