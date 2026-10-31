import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { project, ydoc } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { createSandbox, type Sandbox } from "../testing";
import {
	createSyncedDocuments,
	documentKind,
	documentName,
	type SyncedDocuments,
} from "./synced-documents";

/** The documents a Replica syncs, by name: one module over its `ydoc` rows. */

let sandbox: Sandbox;
let documents: SyncedDocuments;

beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createSyncedDocuments({ db: sandbox.db });
	await sandbox.db.insert(project).values({
		id: "shop",
		spaceId: sandbox.spaceId,
		name: "Shop",
		createdAt: new Date(),
	});
});

afterEach(async () => {
	await documents.close();
	await sandbox.cleanup();
});

describe("the name of a document", () => {
	test("says its kind and its id, and is made back from them", () => {
		for (const [name, kind, id] of [
			["device:laptop", "device", "laptop"],
			["device-copy:laptop", "device-copy", "laptop"],
			["space:team", "space", "team"],
			["flows:shop", "flows", "shop"],
			["flows-history:shop", "flows-history", "shop"],
			["knowledge:shop", "knowledge", "shop"],
		] as const) {
			expect(documentKind(name)).toEqual({ kind, id });
			expect(documentName(kind, id)).toBe(name);
		}
		for (const name of ["flows:", "notes:shop", "devices:x", ""]) {
			expect(documentKind(name)).toBeNull();
		}
	});
});

describe("synced documents", () => {
	test("open opens a document once, and refuses a name of no kind", async () => {
		const first = await documents.open("knowledge:shop");
		expect(await documents.open("knowledge:shop")).toBe(first);
		await expect(documents.open("notes:shop")).rejects.toThrow();
	});

	test("find opens the documents of a Project or a Space the Replica has, and no others", async () => {
		for (const name of [
			"flows:shop",
			"flows-history:shop",
			"knowledge:shop",
			`space:${sandbox.spaceId}`,
		]) {
			expect((await documents.find(name))?.name).toBe(name);
		}
		for (const name of [
			"flows:elsewhere",
			"space:elsewhere",
			"device-copy:laptop",
			"device:laptop",
			"notes:shop",
		]) {
			expect(await documents.find(name)).toBeNull();
		}
		const own = await documents.open("device:laptop");
		expect(await documents.find("device:laptop")).toBe(own);
	});

	test("documentOf names the Device of a Device document, and the Space of the others", async () => {
		expect(await documents.documentOf("device:laptop")).toEqual({
			kind: "device",
			deviceId: "laptop",
		});
		expect(await documents.documentOf(`space:${sandbox.spaceId}`)).toEqual({
			kind: "space",
			spaceId: sandbox.spaceId,
		});
		for (const [name, kind] of [
			["flows:shop", "flows"],
			["flows-history:shop", "flows"],
			["knowledge:shop", "knowledge"],
		] as const) {
			expect(await documents.documentOf(name)).toEqual({
				kind,
				spaceId: sandbox.spaceId,
			});
		}
		for (const name of ["flows:elsewhere", "device-copy:laptop", "x:y"]) {
			expect(await documents.documentOf(name)).toBeNull();
		}
	});

	test("ofSpace gives the Space document and the documents of each of its Projects", async () => {
		const names = (await documents.ofSpace(sandbox.spaceId)).map((d) => d.name);
		expect(names).toEqual([
			`space:${sandbox.spaceId}`,
			"flows:shop",
			"flows-history:shop",
			"knowledge:shop",
		]);
	});

	test("a view handles its kind: once when a document opens, and after each write", async () => {
		const seen: string[] = [];
		documents.handle("knowledge", {
			async opened(document) {
				seen.push(`opened ${document.name}`);
			},
			async stored(document) {
				seen.push(`stored ${document.name}`);
			},
		});
		const document = await documents.open("knowledge:shop");
		await documents.open("knowledge:shop");
		await document.change(() => document.doc.getMap("files").set("a", 1));
		await documents.open("flows:shop");
		expect(seen).toEqual(["opened knowledge:shop", "stored knowledge:shop"]);
	});

	test("remove closes a document and deletes it from the Replica", async () => {
		const document = await documents.open("device-copy:laptop");
		await document.change(() => document.doc.getMap("facts").set("a", 1));
		const stored = async () =>
			(
				await sandbox.db
					.select()
					.from(ydoc)
					.where(eq(ydoc.name, "device-copy:laptop"))
			).length;
		expect(await stored()).toBe(1);
		await documents.remove("device-copy:laptop");
		expect(await stored()).toBe(0);
		const again = await documents.open("device-copy:laptop");
		expect(again).not.toBe(document);
		expect(again.doc.getMap("facts").size).toBe(0);
	});
});
