import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import {
	clone,
	event,
	member,
	organization,
	project,
	user,
	ydoc,
} from "@nightshift/db/schema";
import { asc, eq } from "drizzle-orm";
import type * as Y from "yjs";

import { createEngine } from "../run/engine";
import { aloneDirectory } from "../testing/alone-directory";
import {
	createSandbox,
	otherSpace,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import {
	createSpaceDocuments,
	memberName,
	type SpaceDocuments,
	spaceDocumentName,
	spaceProjects,
} from "./space-document";

/**
 * The Space document defines a Space's Projects; the Replica's `project`
 * rows are its projection. Clones are known by existence only.
 */

let sandbox: Sandbox;
let documents: SpaceDocuments;
let signal: AbortController;
beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createSpaceDocuments({
		db: sandbox.db,
		directory: aloneDirectory(sandbox.db),
	});
	signal = new AbortController();
});
afterEach(async () => {
	signal.abort();
	await documents.close();
	await sandbox.cleanup();
});

function makeEngine() {
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			spaceDocuments: documents,
		}),
		{ signal: signal.signal },
	);
}

/** An edit as a client of the relay makes it: not the Owner's origin. */
function asClient(doc: Y.Doc, fn: () => void) {
	doc.transact(fn, "a-client");
}

const projectRows = () =>
	sandbox.db
		.select({
			id: project.id,
			spaceId: project.spaceId,
			name: project.name,
			removedAt: project.removedAt,
		})
		.from(project)
		.orderBy(asc(project.id));

describe("import", () => {
	test("the Projects and Clones of a Replica from before come in once, without paths", async () => {
		// What a Replica from before the Space document has.
		await sandbox.db.insert(project).values({
			id: "p1",
			spaceId: sandbox.spaceId,
			name: "app",
			remote: "github.com/acme/app",
		});
		await sandbox.db.insert(clone).values({
			id: "c1",
			spaceId: sandbox.spaceId,
			projectId: "p1",
			deviceId: sandbox.deviceId,
			path: "/Users/ada/src/app",
		});

		const document = await documents.open(sandbox.spaceId);
		expect(document.name).toBe(spaceDocumentName(sandbox.spaceId));
		expect(spaceProjects(document).get("p1")).toMatchObject({
			name: "app",
			remote: "github.com/acme/app",
			removedAt: null,
		});
		expect(document.clones.toJSON()).toEqual({
			[`p1/${sandbox.deviceId}`]: {
				projectId: "p1",
				deviceId: sandbox.deviceId,
				addedAt: expect.any(Number),
			},
		});
		expect(document.devices.has(sandbox.deviceId)).toBe(true);
		expect(JSON.stringify(document.doc.toJSON())).not.toContain("/Users/ada");
		await document.flush();

		// A second start: nothing is imported again.
		await sandbox.db
			.insert(project)
			.values({ id: "p2", spaceId: sandbox.spaceId, name: "later" });
		const again = createSpaceDocuments({
			db: sandbox.db,
			directory: aloneDirectory(sandbox.db),
		});
		const reopened = await again.open(sandbox.spaceId);
		expect([...spaceProjects(reopened).keys()]).toEqual(["p1"]);
		await again.close();
	});

	test("every Space's document opens with the engine; its Members are mirrored", async () => {
		const engine = makeEngine();
		await engine.space(sandbox.spaceId).listProjects();
		const document = documents.byName(spaceDocumentName(sandbox.spaceId));
		if (!document)
			throw new Error("The personal Space's document is not open.");
		const [owner] = await sandbox.db
			.select({ id: user.id, name: user.name })
			.from(user);
		expect(document.members.toJSON()).toEqual({
			[owner?.id ?? ""]: { name: owner?.name, role: "owner" },
		});
		expect(document.offers.size).toBe(0);
	});
});

describe("projection", () => {
	test("a client's edit of the document reaches the project rows", async () => {
		const document = await documents.open(sandbox.spaceId);
		asClient(document.doc, () => {
			document.projects.set("p9", {
				name: "from a client",
				remote: "github.com/acme/nine",
				createdAt: 1,
				removedAt: null,
				updatedAt: 1,
			});
		});
		await waitFor(async () => (await projectRows()).length === 1);

		asClient(document.doc, () => {
			document.projects.set("p9", {
				name: "renamed",
				remote: "github.com/acme/nine",
				createdAt: 1,
				removedAt: 5,
				updatedAt: 2,
			});
		});
		await waitFor(async () => (await projectRows())[0]?.name === "renamed");
		expect(await projectRows()).toEqual([
			{
				id: "p9",
				spaceId: sandbox.spaceId,
				name: "renamed",
				removedAt: new Date(5),
			},
		]);
	});

	test("an entry for a project of another Space does not take its row", async () => {
		const elsewhere = await otherSpace(sandbox.db);
		await sandbox.db
			.insert(project)
			.values({ id: "p1", spaceId: elsewhere, name: "theirs" });
		const document = await documents.open(sandbox.spaceId);
		await document.change(() => {
			document.projects.set("p1", {
				name: "mine now",
				remote: null,
				createdAt: 1,
				removedAt: null,
				updatedAt: 1,
			});
		});
		expect(await projectRows()).toEqual([
			{ id: "p1", spaceId: elsewhere, name: "theirs", removedAt: null },
		]);
	});
});

describe("remove", () => {
	const stored = async (spaceId: string) =>
		(
			await sandbox.db
				.select({ name: ydoc.name })
				.from(ydoc)
				.where(eq(ydoc.name, spaceDocumentName(spaceId)))
		).length;

	test("the document of a Space this Replica no longer has goes, open or not", async () => {
		const gone = await otherSpace(sandbox.db, "Gone");
		const document = await documents.open(gone);
		await document.flush();
		expect(await stored(gone)).toBe(1);
		await sandbox.db.delete(organization).where(eq(organization.id, gone));

		await documents.remove(gone);

		expect(await stored(gone)).toBe(0);
		expect(documents.byName(spaceDocumentName(gone))).toBeNull();
	});

	test("the document of a Space that is still here, or that has a project here, stays", async () => {
		const kept = await otherSpace(sandbox.db, "Kept");
		await (await documents.open(kept)).flush();
		await expect(documents.remove(kept)).rejects.toThrow("still here");

		await sandbox.db
			.insert(project)
			.values({ id: "p1", spaceId: kept, name: "left behind" });
		await sandbox.db.delete(organization).where(eq(organization.id, kept));
		await expect(documents.remove(kept)).rejects.toThrow("still here");
		expect(await stored(kept)).toBe(1);
	});
});

describe("the engine writes the document", () => {
	test("add, rename and remove a Project: the document first, the row follows", async () => {
		const mine = makeEngine().space(sandbox.spaceId);
		const added = await mine.addProject({ repoPath: sandbox.repoPath });
		expect(added.clones).toEqual([
			{
				deviceId: sandbox.deviceId,
				deviceName: expect.any(String),
				thisDevice: true,
			},
		]);
		const document = await documents.open(sandbox.spaceId);
		expect(spaceProjects(document).get(added.id)?.name).toBe("repo");
		// The Clone is known; its folder is not.
		expect(JSON.stringify(document.doc.toJSON())).not.toContain(
			sandbox.repoPath,
		);

		const renamed = await mine.renameProject(added.id, "The app");
		expect(renamed.name).toBe("The app");
		expect(spaceProjects(document).get(added.id)?.name).toBe("The app");
		expect((await projectRows())[0]?.name).toBe("The app");

		await mine.removeProject(added.id);
		expect(spaceProjects(document).get(added.id)?.removedAt).toEqual(
			expect.any(Number),
		);
		expect(await mine.listProjects()).toEqual([]);

		const types = (
			await sandbox.db.select({ type: event.type }).from(event)
		).map((e) => e.type);
		expect(types).toEqual(["ProjectAdded", "ProjectRenamed", "ProjectRemoved"]);
	});

	test("a Project renamed through the document shows under its new name", async () => {
		const mine = makeEngine().space(sandbox.spaceId);
		const added = await mine.addProject({ repoPath: sandbox.repoPath });
		const document = await documents.open(sandbox.spaceId);
		const entry = spaceProjects(document).get(added.id);
		asClient(document.doc, () => {
			document.projects.set(added.id, { ...entry, name: "Edited elsewhere" });
		});
		await waitFor(
			async () => (await mine.listProjects())[0]?.name === "Edited elsewhere",
		);
	});

	test("a Clone of another Device in the document shows beside this one", async () => {
		const mine = makeEngine().space(sandbox.spaceId);
		const added = await mine.addProject({ repoPath: sandbox.repoPath });
		const document = await documents.open(sandbox.spaceId);
		asClient(document.doc, () => {
			document.clones.set(`${added.id}/studio`, {
				projectId: added.id,
				deviceId: "studio",
				addedAt: Date.now() + 1,
			});
			document.devices.set("studio", { name: "studio", updatedAt: 1 });
		});
		const [listed] = await mine.listProjects();
		expect(listed?.clones).toEqual([
			{
				deviceId: sandbox.deviceId,
				deviceName: expect.any(String),
				thisDevice: true,
			},
			{ deviceId: "studio", deviceName: "studio", thisDevice: false },
		]);
	});
});

describe("members", () => {
	test("the mirror follows the auth tables", async () => {
		const space = await otherSpace(sandbox.db, "Platform");
		await sandbox.db.insert(user).values([
			{ id: "u-ada", name: "Ada", email: "ada@example.com" },
			{ id: "u-bob", name: "Bob", email: "bob@example.com" },
		]);
		await sandbox.db.insert(member).values([
			{
				id: "m1",
				organizationId: space,
				userId: "u-ada",
				role: "owner",
				createdAt: new Date(),
			},
			{
				id: "m2",
				organizationId: space,
				userId: "u-bob",
				role: "viewer",
				createdAt: new Date(),
			},
		]);
		const document = await documents.open(space);
		expect(document.members.toJSON()).toEqual({
			"u-ada": { name: "Ada", role: "owner" },
			"u-bob": { name: "Bob", role: "viewer" },
		});

		await sandbox.db.delete(member).where(eq(member.id, "m2"));
		await sandbox.db
			.update(member)
			.set({ role: "admin" })
			.where(eq(member.id, "m1"));
		await documents.mirrorMembers(space);
		expect(document.members.toJSON()).toEqual({
			"u-ada": { name: "Ada", role: "admin" },
		});
		expect(
			(await sandbox.db.select().from(organization)).map((o) => o.id),
		).toContain(space);
	});

	test("a Member's name comes from the mirror", async () => {
		const space = await otherSpace(sandbox.db, "Platform");
		await sandbox.db
			.insert(user)
			.values({ id: "u-ada", name: "Ada", email: "ada@example.com" });
		await sandbox.db.insert(member).values({
			id: "m1",
			organizationId: space,
			userId: "u-ada",
			role: "owner",
			createdAt: new Date(),
		});
		const document = await documents.open(space);
		expect(memberName(document, "u-ada")).toBe("Ada");
		expect(memberName(document, "u-nobody")).toBeNull();
		// An entry that is not a Member's shape has no name.
		document.members.set("u-odd", { role: "viewer" });
		expect(memberName(document, "u-odd")).toBeNull();
	});
});
