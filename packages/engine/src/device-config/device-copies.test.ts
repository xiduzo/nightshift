import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { createSyncedDocuments } from "../documents";
import { createSandbox, type Sandbox } from "../testing";
import { createDeviceCopies } from "./device-copies";
import { createProfileStore } from "./profiles";

/**
 * The copies of the owner's other Devices' documents: kept for the Devices
 * the home Host lists, dropped for the rest, and read for their names,
 * profiles and secret names.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** Another Device's own document, as its Owner writes it. */
async function laptopDocument() {
	const other = await createSandbox();
	const document = await other.openDocument();
	await createProfileStore({ document }).save({
		name: "builder",
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		clis: [],
		connections: [],
	});
	await document.change(() => {
		document.facts.set("name", "Laptop");
		document.facts.set("platform", "darwin");
		document.facts.set("secrets", ["OLD_NAME", { name: "GH_TOKEN", setAt: 5 }]);
		document.facts.set("checkedAt", 7);
	});
	return { other, update: Y.encodeStateAsUpdate(document.doc), document };
}

/** The copies over a Replica's synced documents, and the documents, to close as a restart does. */
function copiesOf(replica: Sandbox) {
	const documents = createSyncedDocuments({ db: replica.db });
	return Object.assign(
		createDeviceCopies({ db: replica.db, selfId: replica.deviceId, documents }),
		{ documents },
	);
}

describe("device copies", () => {
	test("a listed Device's document syncs into its copy: its name, profiles and secret names", async () => {
		const copies = copiesOf(sandbox);
		const [synced] = await copies.keep([
			{ id: "laptop", name: "laptop.local" },
		]);
		expect(synced?.name).toBe("device:laptop");

		const { other, update } = await laptopDocument();
		Y.applyUpdate(synced?.doc as Y.Doc, update);
		expect(await copies.get("laptop")).toEqual({
			deviceId: "laptop",
			name: "Laptop",
			platform: "darwin",
			profiles: [
				{
					id: expect.any(String),
					name: "builder",
					kind: "agent",
					permissionMode: "acceptEdits",
				},
			],
			secrets: [
				{ name: "GH_TOKEN", setAt: 5 },
				{ name: "OLD_NAME", setAt: null },
			],
			checkedAt: 7,
		});
		await copies.documents.close();
		await other.cleanup();
	});

	test("a copy lasts across a restart, and the Host's name stands in for a Device that reports none", async () => {
		const first = copiesOf(sandbox);
		const synced = await first.keep([{ id: "desktop", name: "Desktop" }]);
		for (const { doc } of synced) doc.getMap("facts").set("platform", "linux");
		expect((await first.get("desktop"))?.name).toBe("Desktop");
		await first.documents.close();

		const again = copiesOf(sandbox);
		expect(await again.list()).toEqual([
			expect.objectContaining({
				deviceId: "desktop",
				platform: "linux",
				name: null,
			}),
		]);
		await again.documents.close();
	});

	test("a Device the Host no longer lists loses its copy; this computer is never a copy", async () => {
		const copies = copiesOf(sandbox);
		const synced = await copies.keep([
			{ id: "laptop", name: "Laptop" },
			{ id: "desktop", name: "Desktop" },
			{ id: sandbox.deviceId, name: "This one" },
		]);
		for (const { doc } of synced) doc.getMap("facts").set("checkedAt", 1);
		expect((await copies.list()).map((c) => c.deviceId)).toEqual([
			"desktop",
			"laptop",
		]);

		await copies.keep([{ id: "laptop", name: "Laptop" }]);
		expect((await copies.list()).map((c) => c.deviceId)).toEqual(["laptop"]);
		expect(await copies.get("desktop")).toBeNull();
		expect(await copies.get(sandbox.deviceId)).toBeNull();
		await copies.documents.close();

		const again = copiesOf(sandbox);
		expect((await again.list()).map((c) => c.deviceId)).toEqual(["laptop"]);
		await again.documents.close();
	});
});
