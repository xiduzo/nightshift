import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Document } from "@langchain/core/documents";
import { index } from "@langchain/core/indexing";
import { SynonymEmbeddings } from "../testing/embeddings";
import { createSearchTables } from "./search-store";
import { embedText, splitSections } from "./sections";
import { BunSqliteRecordManager, BunSqliteVectorStore } from "./vectors";

const open = () => {
	const db = new Database(":memory:");
	createSearchTables(db);
	return db;
};

describe("the record manager", () => {
	test("its clock strictly increases, also within one millisecond and after a restart", async () => {
		const db = open();
		const records = new BunSqliteRecordManager(db, "knowledge:p1");
		const times: number[] = [];
		for (let i = 0; i < 50; i++) times.push(await records.getTime());
		for (let i = 1; i < times.length; i++) {
			expect(times[i] as number).toBeGreaterThan(times[i - 1] as number);
		}
		await records.update(["a"], {});
		const last = await records.getTime();
		const again = new BunSqliteRecordManager(db, "knowledge:p1");
		expect(await again.getTime()).toBeGreaterThan(last - 1e-3);
	});

	test("updates, lists by time and group, and deletes keys, per namespace", async () => {
		const db = open();
		const records = new BunSqliteRecordManager(db, "knowledge:p1");
		const other = new BunSqliteRecordManager(db, "knowledge:p2");
		await records.update(["a", "b"], { groupIds: ["x.md", "y.md"] });
		const middle = await records.getTime();
		await records.update(["c"], { groupIds: ["x.md"] });
		await other.update(["a"], { groupIds: ["x.md"] });

		expect(await records.exists(["a", "c", "z"])).toEqual([true, true, false]);
		expect((await records.listKeys()).sort()).toEqual(["a", "b", "c"]);
		expect((await records.listKeys({ before: middle })).sort()).toEqual([
			"a",
			"b",
		]);
		expect(await records.listKeys({ after: middle })).toEqual(["c"]);
		expect((await records.listKeys({ groupIds: ["x.md"] })).sort()).toEqual([
			"a",
			"c",
		]);
		expect(await records.listKeys({ limit: 1 })).toHaveLength(1);

		// An update without groups keeps the group a key had.
		await records.update(["a"], {});
		expect((await records.listKeys({ groupIds: ["x.md"] })).sort()).toEqual([
			"a",
			"c",
		]);

		await records.deleteKeys(["a", "b"]);
		expect(await records.listKeys()).toEqual(["c"]);
		expect(await other.listKeys()).toEqual(["a"]);
	});

	test("refuses group ids that do not match the keys", async () => {
		const records = new BunSqliteRecordManager(open(), "knowledge:p1");
		await expect(
			records.update(["a", "b"], { groupIds: ["x"] }),
		).rejects.toThrow();
	});
});

describe("the vector store", () => {
	test("keeps the ids it gets, finds the closest first, and deletes by id, per project", async () => {
		const db = open();
		const embeddings = new SynonymEmbeddings();
		const store = new BunSqliteVectorStore(embeddings, db, "p1");
		const other = new BunSqliteVectorStore(embeddings, db, "p2");
		await store.addDocuments(
			[
				new Document({
					pageContent: "We ship on Fridays",
					metadata: { path: "a.md" },
				}),
				new Document({
					pageContent: "The kitten sleeps",
					metadata: { path: "b.md" },
				}),
				new Document({
					pageContent: "What a car costs",
					metadata: { path: "c.md" },
				}),
			],
			{ ids: ["one", "two", "three"] },
		);
		await other.addDocuments(
			[new Document({ pageContent: "A feline", metadata: { path: "z.md" } })],
			{ ids: ["one"] },
		);
		expect(store.count()).toBe(3);

		const found = await store.similaritySearchWithScore("release day", 2);
		expect(found.map(([doc]) => doc.id)).toEqual(["one", expect.any(String)]);
		expect(found[0]?.[0].metadata).toEqual({ path: "a.md" });
		expect(found[0]?.[1]).toBeGreaterThan(found[1]?.[1] ?? 1);

		const cat = await store.similaritySearchWithScore("cat", 1);
		expect(cat[0]?.[0].pageContent).toBe("The kitten sleeps");

		await store.delete({ ids: ["two"] });
		expect(store.count()).toBe(2);
		const after = await store.similaritySearchWithScore("cat", 3);
		expect(after.map(([doc]) => doc.id)).not.toContain("two");
		expect(other.count()).toBe(1);
	});
});

describe("index() on bun:sqlite", () => {
	test("embeds only new sections, drops changed ones, and removes a file's with full cleanup", async () => {
		const db = open();
		const embeddings = new SynonymEmbeddings();
		const records = new BunSqliteRecordManager(db, "knowledge:p1");
		const store = new BunSqliteVectorStore(embeddings, db, "p1");
		const files: Record<string, string> = {
			"a.md": "# Cars\n\nA car is a vehicle.",
			"b.md": "# Cats\n\nA kitten is a cat.",
			"c.md": "# Money\n\nWhat it costs.",
		};
		const docs = async (fs: Record<string, string>) =>
			(
				await Promise.all(
					Object.entries(fs).map(([path, text]) => splitSections(path, text)),
				)
			)
				.flat()
				.map(
					(doc) =>
						new Document({
							pageContent: doc.pageContent,
							metadata: { path: doc.metadata.path },
						}),
				);
		const run = async (fs: Record<string, string>) => {
			embeddings.embedded = 0;
			const result = await index({
				docsSource: await docs(fs),
				recordManager: records,
				vectorStore: store,
				options: { cleanup: "full", sourceIdKey: "path" },
			});
			return { ...result, embedded: embeddings.embedded, rows: store.count() };
		};

		expect(await run(files)).toEqual({
			numAdded: 3,
			numDeleted: 0,
			numUpdated: 0,
			numSkipped: 0,
			embedded: 3,
			rows: 3,
		});
		expect(await run(files)).toMatchObject({
			numAdded: 0,
			numDeleted: 0,
			numSkipped: 3,
			embedded: 0,
			rows: 3,
		});
		const edited = {
			...files,
			"a.md": "# Cars\n\nAn automobile is a vehicle.",
		};
		expect(await run(edited)).toMatchObject({
			numAdded: 1,
			numDeleted: 1,
			numSkipped: 2,
			embedded: 1,
			rows: 3,
		});
		const rest: Record<string, string> = { ...edited };
		delete rest["b.md"];
		expect(await run(rest)).toMatchObject({
			numAdded: 0,
			numDeleted: 1,
			numSkipped: 2,
			embedded: 0,
			rows: 2,
		});
	});
});

describe("sections", () => {
	test("cut markdown by heading, each with its heading and the line it starts on", async () => {
		const long = "word ".repeat(300).trim();
		const text = `# Guide\n\nIntro.\n\n## Install\n\n${long}\n\n## Deploy\n\n\`\`\`sh\n# not a heading\n\`\`\`\n\nShip it.\n`;
		const sections = await splitSections("wiki/guide.md", text);
		expect(sections.length).toBeGreaterThan(2);
		const deploy = sections.find((s) => s.pageContent.includes("Ship it."));
		expect(deploy?.metadata.heading).toBe("Deploy");
		expect(deploy?.pageContent.startsWith("## Deploy")).toBe(true);
		const lines = text.split("\n");
		expect(lines[(deploy?.metadata.line ?? 0) - 1]).toBe("## Deploy");
		expect(sections[0]?.metadata).toEqual({
			path: "wiki/guide.md",
			heading: "Guide",
			headingPath: "Guide",
			line: 1,
			page: null,
		});
	});

	test("carry the headings open where they start, one per level", async () => {
		const text = [
			"---",
			"# not a heading",
			"---",
			"# Vectors",
			"",
			"Intro.",
			"",
			`## 4 The plan\n\n${"word ".repeat(300).trim()}`,
			"",
			`### 4.3 The threshold\n\n${"word ".repeat(300).trim()}\n\nTen points.`,
			"",
			`## 5 Risks\n\n${"word ".repeat(300).trim()}\n\nNone.`,
		].join("\n");
		const sections = await splitSections("v.md", text);
		const under = (words: string) =>
			sections.find((s) => s.pageContent.includes(words))?.metadata;
		// It starts at the front matter, above the first heading, and that is no heading.
		expect(under("Intro.")?.headingPath).toBe("");
		expect(under("Ten points.")?.headingPath).toBe(
			"Vectors › 4 The plan › 4.3 The threshold",
		);
		expect(under("Ten points.")?.heading).toBe("4.3 The threshold");
		// A heading closes the deeper ones and its own level.
		expect(under("None.")?.headingPath).toBe("Vectors › 5 Risks");
	});

	test("give the model the title and the headings above, each once", () => {
		expect(embedText("Vectors", "", "Text.")).toBe("Vectors\n\nText.");
		expect(embedText("Vectors", "Plan › Limit", "Text.")).toBe(
			"Vectors › Plan › Limit\n\nText.",
		);
		// The first heading is the title.
		expect(embedText("Vectors", "Vectors › Plan", "Text.")).toBe(
			"Vectors › Plan\n\nText.",
		);
		expect(embedText("Vectors", "Vectors", "Text.")).toBe("Vectors\n\nText.");
		// The section starts with its own heading.
		expect(
			embedText("Vectors", "Vectors › Plan › Limit", "### Limit\nTen."),
		).toBe("Vectors › Plan\n\n### Limit\nTen.");
		// Only a whole heading repeats.
		expect(embedText("Vec", "Vectors › Plan", "Text.")).toBe(
			"Vec › Vectors › Plan\n\nText.",
		);
	});

	test("keep a document's pages, and give an empty file one empty section", async () => {
		const pages = [
			new Document({
				pageContent: "Page one.",
				metadata: { loc: { pageNumber: 1 } },
			}),
			new Document({ pageContent: "", metadata: { loc: { pageNumber: 2 } } }),
			new Document({
				pageContent: "Page three.",
				metadata: { loc: { pageNumber: 3 } },
			}),
		];
		const sections = await splitSections("a.pdf", pages);
		expect(sections.map((s) => [s.pageContent, s.metadata.page])).toEqual([
			["Page one.", 1],
			["Page three.", 3],
		]);
		expect(await splitSections("empty.txt", "  \n")).toEqual([
			expect.objectContaining({
				pageContent: "",
				metadata: {
					path: "empty.txt",
					heading: null,
					headingPath: "",
					line: 1,
					page: null,
				},
			}),
		]);
	});
});
