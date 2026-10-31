import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { clone, device, event, project } from "@nightshift/db/schema";
import { asc, eq } from "drizzle-orm";
import { createRunLog } from "../log/run-log";
import { aloneDirectory } from "../testing/alone-directory";
import {
	createSandbox,
	mustGit,
	otherSpace,
	type Sandbox,
} from "../testing/test-support";
import { createProjects, PROJECT_NOT_FOUND } from "./projects";
import { normaliseRemote } from "./remote";
import { createSpaceDocuments, type SpaceDocuments } from "./space-document";

let sandbox: Sandbox;
let documents: SpaceDocuments;
beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createSpaceDocuments({
		db: sandbox.db,
		directory: aloneDirectory(sandbox.db),
	});
});
afterEach(async () => {
	await documents.flush();
	await sandbox.cleanup();
});

const projectsOf = (over: SpaceDocuments = documents) =>
	createProjects({
		db: sandbox.db,
		log: createRunLog(sandbox.db, { walkerId: sandbox.deviceId }),
		deviceId: async () => sandbox.deviceId,
		documents: over,
		directory: aloneDirectory(sandbox.db),
	});

/** A new git repository under the sandbox, with `origin` set when given. */
async function repo(name: string, origin?: string): Promise<string> {
	const path = join(sandbox.root, name);
	await mkdir(path, { recursive: true });
	await mustGit(path, ["init", "-q", "-b", "main"]);
	if (origin) await mustGit(path, ["remote", "add", "origin", origin]);
	return path;
}

const clones = () =>
	sandbox.db
		.select({
			projectId: clone.projectId,
			deviceId: clone.deviceId,
			path: clone.path,
		})
		.from(clone)
		.orderBy(asc(clone.createdAt));

describe("normaliseRemote", () => {
	test("the ssh, scp-like and https URLs of one repository are one string", () => {
		for (const url of [
			"git@github.com:acme/app.git",
			"git@github.com:acme/app",
			"ssh://git@github.com/acme/app.git",
			"ssh://git@github.com:22/acme/app.git",
			"https://github.com/acme/app.git",
			"https://github.com/acme/app/",
			"https://ada:token@GitHub.com/acme/app.git",
			"http://github.com:80/acme/app",
			"git://github.com/acme/app.git",
		]) {
			expect(normaliseRemote(url)).toBe("github.com/acme/app");
		}
	});

	test("the path keeps its case and its depth", () => {
		expect(normaliseRemote("git@gitlab.com:Acme/Group/App.git")).toBe(
			"gitlab.com/Acme/Group/App",
		);
	});

	test("a path on this computer is no remote", () => {
		for (const url of [
			"/srv/git/app.git",
			"../app",
			"file:///srv/git/app.git",
			"C:\\repos\\app",
			"",
		]) {
			expect(normaliseRemote(url)).toBeNull();
		}
	});
});

describe("projects by remote", () => {
	test("a folder becomes a project with its remote and a Clone here", async () => {
		const path = await repo("app", "git@github.com:acme/app.git");
		const added = await projectsOf().add({ repoPath: path }, sandbox.spaceId);
		expect(added).toMatchObject({
			name: "app",
			remote: "github.com/acme/app",
			repoPath: path,
		});
		expect(await clones()).toEqual([
			{ projectId: added.id, deviceId: sandbox.deviceId, path },
		]);
	});

	test("a folder whose origin names a known project makes a Clone of it", async () => {
		// The project as another Device's Clone brought it.
		await sandbox.db
			.insert(device)
			.values({ id: "studio", name: "studio", platform: "linux" });
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
			deviceId: "studio",
			path: "/home/ada/app",
		});

		const path = await repo("mine", "https://github.com/acme/app.git");
		const added = await projectsOf().add({ repoPath: path }, sandbox.spaceId);

		expect(added.id).toBe("p1");
		expect(added.repoPath).toBe(path);
		expect(await sandbox.db.select().from(project)).toHaveLength(1);
		expect(await clones()).toEqual([
			{ projectId: "p1", deviceId: "studio", path: "/home/ada/app" },
			{ projectId: "p1", deviceId: sandbox.deviceId, path },
		]);
		const [logged] = await sandbox.db
			.select()
			.from(event)
			.where(eq(event.type, "CloneAdded"));
		expect(JSON.parse(logged?.payload ?? "null")).toEqual({
			projectId: "p1",
			deviceId: sandbox.deviceId,
			path,
		});
	});

	test("a second folder of a project here is refused while the first exists", async () => {
		const projects = projectsOf();
		const first = await repo("one", "git@github.com:acme/app.git");
		await projects.add({ repoPath: first }, sandbox.spaceId);
		const second = await repo("two", "https://github.com/acme/app");
		await expect(
			projects.add({ repoPath: second }, sandbox.spaceId),
		).rejects.toThrow(`This computer already has this project, in ${first}.`);
	});

	test("a project whose folder moved follows it to the new folder", async () => {
		const projects = projectsOf();
		const old = await repo("old", "git@github.com:acme/app.git");
		const added = await projects.add({ repoPath: old }, sandbox.spaceId);
		const moved = join(sandbox.root, "moved");
		await rename(old, moved);

		const again = await projects.add({ repoPath: moved }, sandbox.spaceId);
		expect(again.id).toBe(added.id);
		expect((await projects.get(added.id)).repoPath).toBe(moved);
		expect(await clones()).toHaveLength(1);
	});

	test("folders without a remote stay projects of their own", async () => {
		const projects = projectsOf();
		const a = await projects.add(
			{ repoPath: await repo("a") },
			sandbox.spaceId,
		);
		const b = await projects.add(
			{ repoPath: await repo("b") },
			sandbox.spaceId,
		);
		expect(a.id).not.toBe(b.id);
		expect([a.remote, b.remote]).toEqual([null, null]);
		expect(
			await projects.add({ repoPath: a.repoPath }, sandbox.spaceId),
		).toMatchObject({
			id: a.id,
		});
	});

	test("readRemotes fills in the remote of a project from before Clones", async () => {
		// What the migration leaves: a project without its remote, its Clone here.
		await sandbox.db
			.insert(project)
			.values({ id: "p1", spaceId: sandbox.spaceId, name: "app" });
		const path = await repo("app", "git@github.com:acme/app.git");
		await sandbox.db.insert(clone).values({
			id: "c1",
			spaceId: sandbox.spaceId,
			projectId: "p1",
			deviceId: sandbox.deviceId,
			path,
		});
		// A second clone of the same repository was a project of its own: it stays so.
		await sandbox.db
			.insert(project)
			.values({ id: "p2", spaceId: sandbox.spaceId, name: "app-2" });
		await sandbox.db.insert(clone).values({
			id: "c2",
			spaceId: sandbox.spaceId,
			projectId: "p2",
			deviceId: sandbox.deviceId,
			path: await repo("app-2", "https://github.com/acme/app.git"),
		});

		await projectsOf().readRemotes();

		const rows = await sandbox.db
			.select({ id: project.id, remote: project.remote })
			.from(project)
			.orderBy(asc(project.id));
		expect(rows).toEqual([
			{ id: "p1", remote: "github.com/acme/app" },
			{ id: "p2", remote: null },
		]);
	});
});

describe("what the peers ask of the Projects", () => {
	/** The Space documents of a Replica whose Space `spaceId` a Host keeps. */
	function keptElsewhere(spaceId: string): SpaceDocuments {
		return createSpaceDocuments({
			db: sandbox.db,
			directory: {
				...aloneDirectory(sandbox.db),
				hostedElsewhere: async (id) => id === spaceId,
			},
		});
	}

	test("recordClone records another Device's Clone, and refuses a Project the document lacks and a Space a Host keeps", async () => {
		const projects = projectsOf();
		const app = await projects.add(
			{ repoPath: await repo("app") },
			sandbox.spaceId,
		);
		await projects.recordClone(sandbox.spaceId, {
			projectId: app.id,
			deviceId: "studio",
			deviceName: "Studio",
		});
		expect(await projects.clones(sandbox.spaceId, app.id)).toEqual([
			{ deviceId: sandbox.deviceId, deviceName: expect.any(String) },
			{ deviceId: "studio", deviceName: "Studio" },
		]);

		await expect(
			projects.recordClone(sandbox.spaceId, {
				projectId: "unknown",
				deviceId: "studio",
				deviceName: "Studio",
			}),
		).rejects.toThrow(PROJECT_NOT_FOUND);

		const team = await otherSpace(sandbox.db, "Team");
		const tools = await projects.add({ repoPath: await repo("tools") }, team);
		const replica = keptElsewhere(team);
		try {
			await expect(
				projectsOf(replica).recordClone(team, {
					projectId: tools.id,
					deviceId: "studio",
					deviceName: "Studio",
				}),
			).rejects.toThrow(PROJECT_NOT_FOUND);
			expect(
				(await projectsOf(replica).clones(team, tools.id)).map(
					(c) => c.deviceId,
				),
			).toEqual([sandbox.deviceId]);
		} finally {
			await replica.flush();
		}
	});

	test("take writes an entry only where none is, brings a removed Project back and records Clones, in one change", async () => {
		const projects = projectsOf();
		const app = await projects.add(
			{ repoPath: await repo("app") },
			sandbox.spaceId,
		);
		await projects.remove(app.id);
		const document = await documents.open(sandbox.spaceId);
		const before = document.revision(document.projects);

		await projects.take(sandbox.spaceId, {
			define: [
				{
					id: app.id,
					name: "not this name",
					remote: null,
					createdAt: 1,
					removedAt: null,
				},
				{ id: "lib", name: "lib", remote: null, createdAt: 2, removedAt: null },
			],
			restore: [app.id],
			clones: [{ projectId: "lib", deviceId: "studio", deviceName: "Studio" }],
		});

		expect(document.revision(document.projects)).toBe(before + 1);
		// The rows follow the document.
		expect(await projects.find(app.id, sandbox.spaceId)).toMatchObject({
			name: "app",
			removedAt: null,
		});
		expect(await projects.find("lib", sandbox.spaceId)).toMatchObject({
			name: "lib",
			repoPath: null,
		});
		expect(await projects.clones(sandbox.spaceId, "lib")).toEqual([
			{ deviceId: "studio", deviceName: "Studio" },
		]);
	});

	test("take leaves a Space a Host keeps alone", async () => {
		const team = await otherSpace(sandbox.db, "Team");
		const replica = keptElsewhere(team);
		try {
			await projectsOf(replica).take(team, {
				define: [
					{
						id: "lib",
						name: "lib",
						remote: null,
						createdAt: 2,
						removedAt: null,
					},
				],
				clones: [
					{ projectId: "lib", deviceId: "studio", deviceName: "Studio" },
				],
			});
			const kept = await replica.open(team);
			expect([...kept.projects.keys()]).toEqual([]);
			expect([...kept.clones.keys()]).toEqual([]);
		} finally {
			await replica.flush();
		}
	});

	test("clonePath is the folder here: null for another Space and for a removed Project", async () => {
		const projects = projectsOf();
		const path = await repo("app");
		const app = await projects.add({ repoPath: path }, sandbox.spaceId);
		const team = await otherSpace(sandbox.db, "Team");

		expect(await projects.clonePath(app.id, sandbox.spaceId)).toBe(path);
		expect(await projects.clonePath(app.id, team)).toBeNull();
		await projects.remove(app.id);
		expect(await projects.clonePath(app.id, sandbox.spaceId)).toBeNull();
	});

	test("ofSpace marks this computer's Clones, matching finds by id or remote in any Space", async () => {
		const projects = projectsOf();
		const app = await projects.add(
			{ repoPath: await repo("app", "git@github.com:acme/app.git") },
			sandbox.spaceId,
		);
		await projects.take(sandbox.spaceId, {
			define: [
				{ id: "lib", name: "lib", remote: null, createdAt: 2, removedAt: null },
			],
		});

		// Oldest first: lib is older.
		expect(
			(await projects.ofSpace(sandbox.spaceId)).map((p) => [
				p.id,
				p.clone,
				p.walked,
			]),
		).toEqual([
			["lib", false, false],
			[app.id, true, false],
		]);
		expect(
			(
				await projects.matching({
					ids: ["lib"],
					remotes: ["github.com/acme/app"],
				})
			)
				.map((p) => p.id)
				.sort(),
		).toEqual([app.id, "lib"].sort());
		expect(await projects.matching({})).toEqual([]);
	});
});
