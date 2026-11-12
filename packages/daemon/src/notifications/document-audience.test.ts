import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import {
	createSyncedDocuments,
	type SyncedDocuments,
} from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { documentAudience } from "./document-audience";

/**
 * Who hears of a stored synced document, by its kind: the owner for a
 * Device document, the people of the Space for the others, over the
 * Replica's own documents.
 */

let sandbox: Sandbox;
let documents: SyncedDocuments;
beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createSyncedDocuments({ db: sandbox.db });
	await sandbox.db
		.insert(project)
		.values({ id: "shop", spaceId: sandbox.spaceId, name: "shop" });
});
afterEach(async () => {
	await documents.close();
	await sandbox.cleanup();
});

const audienceOf = (name: string) =>
	documentAudience(name, {
		documentOf: (of) => documents.documentOf(of),
		personId: "person-owner",
	});

describe("who hears of a stored document", () => {
	test.each([["device:laptop"], ["device-copy:studio"]])(
		"%s: this computer's owner",
		async (name) => {
			expect(await audienceOf(name)).toEqual({ personId: "person-owner" });
		},
	);

	test("a Space document: the people of that Space", async () => {
		expect(await audienceOf(`space:${sandbox.spaceId}`)).toEqual({
			spaceId: sandbox.spaceId,
		});
	});

	test.each([["flows:shop"], ["flows-history:shop"], ["knowledge:shop"]])(
		"%s: the people of the project's Space",
		async (name) => {
			expect(await audienceOf(name)).toEqual({ spaceId: sandbox.spaceId });
		},
	);

	test.each([["flows:elsewhere"], ["knowledge:elsewhere"]])(
		"%s, a project this computer does not have: nobody",
		async (name) => {
			expect(await audienceOf(name)).toBeNull();
		},
	);

	test.each([["notes:shop"], ["device:"], ["shop"]])(
		"%s, a name of no kind: nobody",
		async (name) => {
			expect(await audienceOf(name)).toBeNull();
		},
	);
});
