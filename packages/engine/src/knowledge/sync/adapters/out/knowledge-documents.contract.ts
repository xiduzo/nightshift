import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { KnowledgeDocuments } from "../../application/ports";
import type { KnowledgeEntry } from "../../domain/entry";

/** One adapter of `KnowledgeDocuments` to test. */
export type KnowledgeDocumentsUnderTest = {
	knowledgeDocuments: KnowledgeDocuments;
	close(): Promise<void>;
};

const entry = (char: string): KnowledgeEntry => ({
	sha256: char.repeat(64),
	size: 1,
	changedAt: 1,
	deviceId: "d1",
});

/**
 * What every adapter of `KnowledgeDocuments` does.
 * `knowledge-documents.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function knowledgeDocumentsContract(
	name: string,
	make: () => Promise<KnowledgeDocumentsUnderTest>,
): void {
	describe(`KnowledgeDocuments contract: ${name}`, () => {
		let under: KnowledgeDocumentsUnderTest;
		let documents: KnowledgeDocuments;
		beforeEach(async () => {
			under = await make();
			documents = under.knowledgeDocuments;
		});
		afterEach(async () => {
			await under.close();
		});

		test("a document with no update is new and lists nothing", async () => {
			const document = await documents.open("p1");
			expect(document.name).toBe("knowledge:p1");
			expect(document.isNew()).toBe(true);
			expect(document.entries().size).toBe(0);
			expect(await documents.sizes()).toEqual([]);
		});

		test("a change removes first, then sets, and reads back", async () => {
			const document = await documents.open("p1");
			await document.apply({ set: [["a.md", entry("a")]] });
			await document.apply({
				delete: ["a.md"],
				set: [
					["a.md", entry("b")],
					["c.md", { ...entry("c"), local: true }],
				],
			});
			expect(document.isNew()).toBe(false);
			expect([...(await documents.open("p1")).entries()]).toEqual([
				["a.md", entry("b")],
				["c.md", { ...entry("c"), local: true }],
			]);
			expect(document.allHashes()).toEqual(
				new Set(["b".repeat(64), "c".repeat(64)]),
			);
			const sizes = await documents.sizes();
			expect(sizes.map((size) => size.projectId)).toEqual(["p1"]);
		});

		test("the settings are on until a person turns them off, and the reader is Night Shift's own", async () => {
			const document = await documents.open("p1");
			expect(document.meaningOn()).toBe(true);
			expect(document.learnsFromRunsOn()).toBe(true);
			expect(document.reader()).toEqual({ kind: "nightshift" });
			await document.setMeaning(false);
			await document.setLearnsFromRuns(false);
			expect(document.meaningOn()).toBe(false);
			expect(document.learnsFromRunsOn()).toBe(false);
		});

		test("a removed document opens again empty", async () => {
			await (await documents.open("p1")).apply({ set: [["a.md", entry("a")]] });
			await documents.remove("p1");
			expect((await documents.open("p1")).entries().size).toBe(0);
		});
	});
}
