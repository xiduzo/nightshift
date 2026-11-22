import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Document } from "@langchain/core/documents";
import { SynonymEmbeddings } from "../testing/embeddings";
import { createSearchTables } from "./tables";
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
