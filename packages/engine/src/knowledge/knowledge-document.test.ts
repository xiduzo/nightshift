import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSyncedDocuments, documentName } from "../documents";
import { createSandbox, type Sandbox } from "../testing";
import {
	createKnowledgeDocuments,
	type KnowledgeEntry,
} from "./knowledge-document";

/** The knowledge document at its interface. A raw Yjs value here is what another version of Night Shift wrote. */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(() => sandbox.cleanup());

const hash = (char: string) => char.repeat(64);
const entry = (char: string): KnowledgeEntry => ({
	sha256: hash(char),
	size: 1,
	changedAt: 1,
	deviceId: "d1",
});

function open() {
	const synced = createSyncedDocuments({ db: sandbox.db });
	return {
		synced,
		documents: createKnowledgeDocuments({ db: sandbox.db, documents: synced }),
	};
}

describe("the knowledge document", () => {
	test("is new until its first change, and names its document in the Space", async () => {
		const document = await open().documents.open("p1");
		expect(document.name).toBe(documentName("knowledge", "p1"));
		expect(document.isNew()).toBe(true);
		await document.apply({ set: [["a.md", entry("a")]] });
		expect(document.isNew()).toBe(false);
		// A removal leaves its history: the document is not new again.
		await document.apply({ delete: ["a.md"] });
		expect(document.isNew()).toBe(false);
		expect(document.entries()).toEqual(new Map());
	});

	test("makes one change of removals and new entries, and writes nothing for no change", async () => {
		const { synced, documents } = open();
		const document = await documents.open("p1");
		await document.apply({ set: [["a.md", entry("a")]] });
		const raw = await synced.open(documentName("knowledge", "p1"));
		let updates = 0;
		raw.doc.on("update", () => {
			updates++;
		});

		await document.apply({
			delete: ["a.md"],
			set: [
				["b.md", entry("b")],
				["c.md", { ...entry("c"), local: true }],
			],
		});
		expect(updates).toBe(1);
		expect([...document.entries().keys()]).toEqual(["b.md", "c.md"]);
		expect(document.entries().get("c.md")?.local).toBe(true);

		await document.apply({});
		await document.apply({ set: [], delete: [] });
		expect(updates).toBe(1);
	});

	test("reads only valid entries of knowledge paths, and still names every hash", async () => {
		const { synced, documents } = open();
		const document = await documents.open("p1");
		await document.apply({ set: [["a.md", entry("a")]] });
		const raw = await synced.open(documentName("knowledge", "p1"));
		await raw.change(() => {
			const files = raw.doc.getMap<unknown>("files");
			files.set("../outside.md", entry("b"));
			files.set("v9.md", { sha256: hash("c"), shape: "of another version" });
			files.set("nothing.md", null);
		});

		expect([...document.entries().keys()]).toEqual(["a.md"]);
		expect(document.allHashes()).toEqual(
			new Set([hash("a"), hash("b"), hash("c")]),
		);
	});

	test("tells the size of each knowledge document it keeps, and of no other document", async () => {
		const { synced, documents } = open();
		expect(await documents.sizes()).toEqual([]);
		const document = await documents.open("p1");
		await document.apply({ set: [["a.md", entry("a")]] });
		const flows = await synced.open(documentName("flows", "p1"));
		await flows.change(() => flows.doc.getMap("x").set("y", 1));
		await synced.flush();

		const [size, ...others] = await documents.sizes();
		expect(others).toEqual([]);
		expect(size?.projectId).toBe("p1");
		const growing = size?.bytes ?? 0;
		expect(growing).toBeGreaterThan(0);

		// A replaced entry leaves a deleted one behind: the size grows.
		await document.apply({ set: [["a.md", entry("b")]] });
		await synced.flush();
		const [after] = await documents.sizes();
		expect(after?.bytes).toBeGreaterThan(growing);
	});

	test("search by meaning is on until a person turns it off", async () => {
		const document = await open().documents.open("p1");
		expect(document.meaningOn()).toBe(true);
		await document.setMeaning(false);
		expect(document.meaningOn()).toBe(false);
		await document.setMeaning(true);
		expect(document.meaningOn()).toBe(true);
	});
});
