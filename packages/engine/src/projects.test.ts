import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { clone, device, event, project } from "@nightshift/db/schema";
import { asc, eq } from "drizzle-orm";

import { createProjects, normaliseRemote } from "./projects";
import { createRunLog } from "./run-log";
import { createSpaceDocuments, type SpaceDocuments } from "./space/document";
import { createSandbox, mustGit, type Sandbox } from "./test-support";

let sandbox: Sandbox;
let documents: SpaceDocuments;
beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createSpaceDocuments({ db: sandbox.db });
});
afterEach(async () => {
	await documents.close();
	await sandbox.cleanup();
});

const projectsOf = () =>
	createProjects({
		db: sandbox.db,
		log: createRunLog(sandbox.db),
		deviceId: async () => sandbox.deviceId,
		documents,
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
