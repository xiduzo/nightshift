import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { project } from "@nightshift/db/schema";
import { createSpaceArchive, type SpaceArchive, sha256Of } from "../archive";
import { createSandbox, type Sandbox } from "../testing";
import { CONTENT_GRACE_MS, collectContent } from "./collect";
import {
	createKnowledgeDocuments,
	type KnowledgeDocuments,
	knowledgeFiles,
} from "./knowledge-document";

/**
 * The collection of knowledge content on the Replica that keeps a Space:
 * content no document lists goes once its grace period is over, and
 * nothing else does.
 */

let sandbox: Sandbox;
let archive: SpaceArchive;
let documents: KnowledgeDocuments;
const OTHER = "space-of-a-host";

beforeEach(async () => {
	sandbox = await createSandbox();
	archive = createSpaceArchive(sandbox.dataDir);
	documents = createKnowledgeDocuments({ db: sandbox.db });
	await sandbox.db.insert(project).values([
		{ id: "p1", spaceId: sandbox.spaceId, name: "p1" },
		{
			id: "p2",
			spaceId: sandbox.spaceId,
			name: "p2",
			removedAt: new Date(),
		},
	]);
});
afterEach(() => sandbox.cleanup());

const DAY = 24 * 60 * 60_000;

/** Content kept in the archive here, `ageMs` ago. */
async function kept(spaceId: string, text: string, ageMs: number) {
	const content = new TextEncoder().encode(text);
	const sha256 = sha256Of(content);
	const ref = { kind: "content" as const, spaceId, sha256 };
	await archive.here.write({ ref, content });
	const at = new Date(Date.now() - ageMs);
	await utimes(
		join(sandbox.dataDir, "archive", spaceId, "knowledge", sha256),
		at,
		at,
	);
	return { ref, sha256, content };
}

async function list(projectId: string, path: string, sha256: string) {
	const document = await documents.open(projectId);
	await document.change(() => {
		knowledgeFiles(document).set(path, {
			sha256,
			size: 1,
			changedAt: 1,
			deviceId: "d1",
		});
	});
}

const collect = () =>
	collectContent({
		db: sandbox.db,
		documents,
		archive,
		keeps: async (spaceId) => spaceId === sandbox.spaceId,
	});

describe("the collection of knowledge content", () => {
	test("removes what no document lists once the grace period is over, and keeps the rest", async () => {
		const listed = await kept(sandbox.spaceId, "# Home\n", 30 * DAY);
		const ofRemoved = await kept(sandbox.spaceId, "# Old project\n", 30 * DAY);
		const replaced = await kept(sandbox.spaceId, "# Home, before\n", 30 * DAY);
		const fresh = await kept(sandbox.spaceId, "# Just copied\n", DAY);
		await list("p1", "wiki/Home.md", listed.sha256);
		await list("p2", "notes.md", ofRemoved.sha256);

		expect(await collect()).toEqual({ removed: 1, waiting: 1 });
		expect(await archive.here.read(replaced.ref)).toBeNull();
		for (const stays of [listed, ofRemoved, fresh]) {
			expect(await archive.here.read(stays.ref)).toEqual(stays.content);
		}
		// A second collection finds nothing more to do.
		expect(await collect()).toEqual({ removed: 0, waiting: 1 });
	});

	test("leaves the content of a Space a Host keeps: this Replica's cache", async () => {
		const cached = await kept(OTHER, "# Cached\n", 30 * DAY);
		expect(await collect()).toEqual({ removed: 0, waiting: 0 });
		expect(await archive.here.read(cached.ref)).toEqual(cached.content);
	});

	test("keeps content that a Device copies again: its grace period starts again", async () => {
		const old = await kept(sandbox.spaceId, "# Back again\n", 30 * DAY);
		// A Device copies it again, before its entry reaches the document.
		await archive.here.write({ ref: old.ref, content: old.content });
		expect(await collect()).toEqual({ removed: 0, waiting: 1 });
		expect(await archive.here.read(old.ref)).toEqual(old.content);
	});

	test("never removes content kept after the grace period's start", async () => {
		const old = await kept(sandbox.spaceId, "# Raced\n", 30 * DAY);
		await archive.here.write({ ref: old.ref, content: old.content });
		expect(
			await archive.here.drop(old.ref, {
				keptBefore: Date.now() - CONTENT_GRACE_MS,
			}),
		).toBe(false);
		expect(await archive.here.read(old.ref)).toEqual(old.content);
	});
});
