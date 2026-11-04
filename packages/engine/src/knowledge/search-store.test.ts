import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document } from "@langchain/core/documents";
import { KNOWLEDGE_SEARCH_FILE } from "@nightshift/flows";
import { SynonymEmbeddings } from "../testing/embeddings";
import { createSearchStore, type SearchStore } from "./search-store";
import { sectionId } from "./sections";

let dataDir: string;
let store: SearchStore;
let gone: number;

const indexFile = () => join(dataDir, "knowledge", KNOWLEDGE_SEARCH_FILE);
const model = (name: string, embeddings = new SynonymEmbeddings()) => ({
	model: name,
	embeddings,
});

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-store-"));
	gone = 0;
	store = createSearchStore(dataDir, {
		onVectorsGone: () => {
			gone += 1;
		},
	});
});
afterEach(async () => {
	store.close();
	await rm(dataDir, { recursive: true, force: true });
});

function write(path: string, texts: string[]) {
	store.writeFiles("p1", [
		{
			file: { path, title: path, size: 1, changedAt: 1 } as never,
			row: store.files("p1").get(path),
			same: false,
			sha256: "sha",
			title: "Title",
			sections: texts.map(
				(text, line) =>
					new Document({
						pageContent: text,
						metadata: { path, heading: null, line: line + 1, page: null },
					}),
			),
		},
	]);
}

describe("the index file", () => {
	test("of another schema version is built again, its vector tables too", async () => {
		await mkdir(join(dataDir, "knowledge"), { recursive: true });
		const old = new Database(indexFile(), { create: true });
		old.run(
			"CREATE TABLE vectors (project_id TEXT, id TEXT, text TEXT, metadata TEXT, vec BLOB)",
		);
		old.run(
			"INSERT INTO vectors VALUES ('p1', 'old', 'text', '{}', x'00000000')",
		);
		old.run("PRAGMA user_version = 4");
		old.close();

		await store.open();
		expect(store.vectorsFor("p1", model("fake-model")).count()).toBe(0);
	});

	test("every table is there once it opened: a vector store needs no schema of its own", async () => {
		await store.open();
		write("a.md", ["A car."]);
		const vectors = store.vectorsFor("p1", model("fake-model"));
		await vectors.addDocuments([new Document({ pageContent: "A car." })], {
			ids: ["one"],
		});
		await store.recordsOf("p1").update(["one"], { groupIds: ["a.md"] });
		expect(vectors.count()).toBe(1);
		expect(await store.recordsOf("p1").listKeys()).toEqual(["one"]);
	});

	test("that is closed reads nothing, and opens again", async () => {
		await store.open();
		write("a.md", ["A car."]);
		store.close();
		expect(store.isOpen()).toBe(false);
		expect(() => store.files("p1")).toThrow();
		await store.open();
		expect([...store.files("p1").keys()]).toEqual(["a.md"]);
	});
});

describe("a section's row", () => {
	test("has an id from its path and text, whatever its place in the file", async () => {
		await store.open();
		write("a.md", ["A car.", "A kitten."]);
		const before = store.sectionsToEmbed("p1");
		write("a.md", ["New first.", "A car.", "A kitten."]);
		const after = store.sectionsToEmbed("p1");
		expect(after.map((s) => s.section_id).slice(1)).toEqual(
			before.map((s) => s.section_id),
		);
		expect(before[0]?.section_id).toBe(sectionId("a.md", "Title", "A car."));

		const file = store.fileAt("p1", "a.md");
		const moved = store.section(file?.id ?? 0, before[0]?.section_id ?? "");
		expect(moved).toMatchObject({ line: 2, text: "A car." });
	});

	test("changes id with the file's path and the file's title", () => {
		const id = sectionId("a.md", "Title", "A car.");
		expect(sectionId("b.md", "Title", "A car.")).not.toBe(id);
		expect(sectionId("a.md", "Other", "A car.")).not.toBe(id);
	});

	test("without text gets no vector", async () => {
		await store.open();
		write("a.md", ["", "A car."]);
		expect(store.sectionCount("p1")).toBe(1);
		expect(store.sectionsToEmbed("p1").map((s) => s.text)).toEqual(["A car."]);
	});
});

describe("the model of the vectors", () => {
	test("another model drops the vectors and says so, the same one does not", async () => {
		await store.open();
		const first = model("first");
		const vectors = store.vectorsFor("p1", first);
		await vectors.addDocuments([new Document({ pageContent: "A car." })], {
			ids: ["one"],
		});
		const after = gone;
		expect(store.vectorsFor("p1", first)).toBe(vectors);
		expect(gone).toBe(after);

		expect(store.vectorsFor("p1", model("second")).count()).toBe(0);
		expect(store.vectorModel()).toBe("second");
		expect(gone).toBe(after + 1);
	});

	test("is kept in the file: the same model after a restart keeps its vectors", async () => {
		await store.open();
		const first = model("first");
		await store
			.vectorsFor("p1", first)
			.addDocuments([new Document({ pageContent: "A car." })], {
				ids: ["one"],
			});
		store.close();
		await store.open();
		expect(store.vectorModel()).toBeNull();
		expect(store.vectorsFor("p1", first).count()).toBe(1);
	});
});
