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
import {
	createProjects,
	HOSTED_NEEDS_REMOTE,
	NO_FOLDER,
	PROJECT_NOT_FOUND,
	withoutFolderOf,
} from "./projects";
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
		log: createRunLog(sandbox.db, {
			walkerId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		}),
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

describe("the folder of a project here", () => {
	/** A project of the Space without a Clone here, as a Host's sync brings it. */
	async function synced(remote: string | null = "github.com/acme/app") {
		await sandbox.db.insert(project).values({
			id: "p1",
			spaceId: sandbox.spaceId,
			name: "app",
			remote,
		});
	}

	test("a copy a person has becomes the folder of a project not here yet", async () => {
		await synced();
		const path = await repo("mine", "git@github.com:Acme/App.git");
		const used = await projectsOf().useFolder("p1", path, sandbox.spaceId);
		expect(used).toMatchObject({ id: "p1", repoPath: path });
		expect(await clones()).toEqual([
			{ projectId: "p1", deviceId: sandbox.deviceId, path },
		]);
	});

	test("another folder takes the place of the one a project has", async () => {
		const projects = projectsOf();
		const first = await repo("one", "git@github.com:acme/app.git");
		const added = await projects.add({ repoPath: first }, sandbox.spaceId);
		const second = await repo("two", "https://github.com/acme/app");

		await projects.useFolder(added.id, second, sandbox.spaceId);
		expect((await projects.get(added.id)).repoPath).toBe(second);
		expect(await clones()).toEqual([
			{ projectId: added.id, deviceId: sandbox.deviceId, path: second },
		]);
	});

	test("a folder of another repository is refused", async () => {
		await synced();
		const path = await repo("other", "git@github.com:acme/other.git");
		await expect(
			projectsOf().useFolder("p1", path, sandbox.spaceId),
		).rejects.toThrow("Choose a copy of github.com/acme/app.");
		expect(await clones()).toEqual([]);
	});

	test("a folder that is another project's is refused", async () => {
		const projects = projectsOf();
		const lib = await repo("lib");
		await projects.add({ repoPath: lib }, sandbox.spaceId);
		await synced(null);
		await expect(
			projects.useFolder("p1", lib, sandbox.spaceId),
		).rejects.toThrow("This folder is the project lib already.");
	});

	test("a project of another Space is not found", async () => {
		await synced();
		const path = await repo("mine", "git@github.com:acme/app.git");
		await expect(
			projectsOf().useFolder("p1", path, "elsewhere"),
		).rejects.toThrow(PROJECT_NOT_FOUND);
	});
});

describe("a project without a folder", () => {
	test("has no remote and no Clone, in the Space document and its row", async () => {
		const projects = projectsOf();
		const added = await projects.addWithoutFolder(
			{ name: "Market watch" },
			sandbox.spaceId,
		);
		expect(added).toMatchObject({
			name: "Market watch",
			spaceId: sandbox.spaceId,
			remote: null,
			folder: false,
			repoPath: null,
		});
		const document = await documents.open(sandbox.spaceId);
		expect(document.projects.get(added.id)).toMatchObject({
			name: "Market watch",
			remote: null,
			folder: false,
		});
		expect(await projects.find(added.id, sandbox.spaceId)).toMatchObject({
			folder: false,
			repoPath: null,
		});
		expect(await projects.clones(sandbox.spaceId, added.id)).toEqual([]);
		expect(await clones()).toEqual([]);
		const [logged] = await sandbox.db
			.select({ payload: event.payload })
			.from(event)
			.where(eq(event.type, "ProjectAdded"));
		expect(JSON.parse(logged?.payload ?? "{}")).toEqual({
			projectId: added.id,
			name: "Market watch",
			remote: null,
			folder: false,
		});

		// A second one of the same name is another project.
		const again = await projects.addWithoutFolder(
			{ name: "Market watch" },
			sandbox.spaceId,
		);
		expect(again.id).not.toBe(added.id);
		expect(await withoutFolderOf(sandbox.db)(added.id)).toBe(true);
	});

	test("a project with a folder says so in the Space document", async () => {
		const projects = projectsOf();
		const app = await projects.add(
			{ repoPath: await repo("app") },
			sandbox.spaceId,
		);
		expect(app.folder).toBe(true);
		expect(await withoutFolderOf(sandbox.db)(app.id)).toBe(false);
		expect(await withoutFolderOf(sandbox.db)("unknown")).toBe(false);
		const document = await documents.open(sandbox.spaceId);
		expect(document.projects.get(app.id)).toMatchObject({ folder: true });
	});

	test("never gets a folder: useFolder refuses it", async () => {
		const projects = projectsOf();
		const added = await projects.addWithoutFolder(
			{ name: "Feeds" },
			sandbox.spaceId,
		);
		await expect(
			projects.useFolder(added.id, await repo("feeds"), sandbox.spaceId),
		).rejects.toThrow(NO_FOLDER);
		expect(await clones()).toEqual([]);
	});

	test("never gets a Clone from another Device", async () => {
		const projects = projectsOf();
		const added = await projects.addWithoutFolder(
			{ name: "Feeds" },
			sandbox.spaceId,
		);
		const record = {
			projectId: added.id,
			deviceId: "studio",
			deviceName: "Studio",
		};
		await expect(projects.recordClone(sandbox.spaceId, record)).rejects.toThrow(
			NO_FOLDER,
		);
		expect(
			await projects.setClones(sandbox.spaceId, {
				deviceId: "studio",
				deviceName: "Studio",
				projectIds: [added.id],
			}),
		).toEqual({ added: [], removed: [] });
		await projects.take(sandbox.spaceId, { clones: [record] });
		expect(await projects.clones(sandbox.spaceId, added.id)).toEqual([]);
	});

	test("in a Space a Host keeps, the Host adds it, and its row is here at once", async () => {
		const team = await otherSpace(sandbox.db, "Team");
		const replica = createSpaceDocuments({
			db: sandbox.db,
			directory: {
				...aloneDirectory(sandbox.db),
				hostedElsewhere: async (id) => id === team,
			},
		});
		const asked: unknown[] = [];
		const projects = createProjects({
			db: sandbox.db,
			log: createRunLog(sandbox.db, {
				walkerId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
			}),
			deviceId: async () => sandbox.deviceId,
			documents: replica,
			directory: {
				...aloneDirectory(sandbox.db),
				hostedElsewhere: async (id: string) => id === team,
			},
			relay: {
				addProject: () => Promise.reject(new Error("Not in this test.")),
				async addWithoutFolder(input) {
					asked.push(input);
					return { projectId: "from-host" };
				},
				addClone: () => Promise.reject(new Error("Not in this test.")),
			},
		});
		try {
			const added = await projects.addWithoutFolder({ name: "Leads" }, team);
			expect(asked).toEqual([{ spaceId: team, name: "Leads" }]);
			expect(added).toMatchObject({
				id: "from-host",
				spaceId: team,
				name: "Leads",
				folder: false,
				repoPath: null,
			});
			// This Replica never writes the Host's document.
			expect((await replica.open(team)).projects.size).toBe(0);
			// The Host's half refuses a Space this Replica does not keep.
			await expect(
				projects.defineWithoutFolder(team, { name: "Leads" }),
			).rejects.toThrow("Your Host keeps the projects of this Space.");
		} finally {
			await replica.flush();
		}
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

	test("add in a Space a Host keeps: the Host adds the Project, and this folder is its Clone", async () => {
		const team = await otherSpace(sandbox.db, "Team");
		const replica = keptElsewhere(team);
		const asked: unknown[] = [];
		const directory = {
			...aloneDirectory(sandbox.db),
			hostedElsewhere: async (id: string) => id === team,
		};
		const projects = createProjects({
			db: sandbox.db,
			log: createRunLog(sandbox.db, {
				walkerId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
			}),
			deviceId: async () => sandbox.deviceId,
			documents: replica,
			directory,
			relay: {
				async addProject(input) {
					asked.push({ addProject: input });
					return { projectId: "from-host" };
				},
				async addWithoutFolder(input) {
					asked.push({ addWithoutFolder: input });
					return { projectId: "without-folder" };
				},
				async addClone(input) {
					asked.push({ addClone: input.projectId });
				},
			},
		});
		try {
			const path = await repo("app", "https://github.com/acme/app.git");
			const added = await projects.add({ repoPath: path }, team);
			expect(added).toMatchObject({
				id: "from-host",
				spaceId: team,
				name: "app",
				remote: "github.com/acme/app",
				repoPath: path,
			});
			expect(asked).toEqual([
				{
					addProject: {
						spaceId: team,
						name: "app",
						remote: "github.com/acme/app",
					},
				},
				{ addClone: "from-host" },
			]);
			expect((await projects.list(team)).map((p) => p.id)).toEqual([
				"from-host",
			]);
			// This Replica never writes the Host's document.
			expect((await replica.open(team)).projects.size).toBe(0);

			// A folder without a remote: the Host has nothing to copy.
			await expect(
				projects.add({ repoPath: await repo("local") }, team),
			).rejects.toThrow(HOSTED_NEEDS_REMOTE);
			expect(asked).toHaveLength(2);
		} finally {
			await replica.flush();
		}
	});

	test("addFromRemote: a new Project without a Clone here, the same one again, a removed one back", async () => {
		const projects = projectsOf();
		const first = await projects.addFromRemote(sandbox.spaceId, {
			name: "app",
			remote: "github.com/acme/app",
		});
		const document = await documents.open(sandbox.spaceId);
		expect(document.projects.get(first.projectId)).toMatchObject({
			name: "app",
			remote: "github.com/acme/app",
			removedAt: null,
		});
		expect(await clones()).toEqual([]);
		const [added] = await sandbox.db
			.select({ payload: event.payload })
			.from(event)
			.where(eq(event.type, "ProjectAdded"));
		expect(JSON.parse(String(added?.payload))).toEqual({
			projectId: first.projectId,
			name: "app",
			remote: "github.com/acme/app",
		});

		expect(
			await projects.addFromRemote(sandbox.spaceId, {
				name: "other name",
				remote: "github.com/acme/app",
			}),
		).toEqual(first);

		await projects.remove(first.projectId);
		await projects.addFromRemote(sandbox.spaceId, {
			name: "app",
			remote: "github.com/acme/app",
		});
		expect(
			(await projects.listInSpace(sandbox.spaceId)).map((p) => p.id),
		).toEqual([first.projectId]);

		const team = await otherSpace(sandbox.db, "Team");
		await expect(
			projects.addFromRemote(team, {
				name: "app",
				remote: "github.com/acme/app",
			}),
		).rejects.toThrow("another Space");
	});

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

	test("setClones makes a Device's Clones in the document exactly the ones it has, and again changes nothing", async () => {
		const projects = projectsOf();
		const app = await projects.add(
			{ repoPath: await repo("app") },
			sandbox.spaceId,
		);
		const tools = await projects.add(
			{ repoPath: await repo("tools") },
			sandbox.spaceId,
		);
		await projects.recordClone(sandbox.spaceId, {
			projectId: app.id,
			deviceId: "studio",
			deviceName: "Studio",
		});
		const deviceIds = async (projectId: string) =>
			(await projects.clones(sandbox.spaceId, projectId)).map(
				(c) => c.deviceId,
			);

		// A lost addClone heals, a Clone the Device no longer has goes, and
		// a Project the document lacks is left out.
		expect(
			await projects.setClones(sandbox.spaceId, {
				deviceId: "studio",
				deviceName: "Studio",
				projectIds: [tools.id, "unknown"],
			}),
		).toEqual({ added: [tools.id], removed: [app.id] });
		expect(await deviceIds(app.id)).toEqual([sandbox.deviceId]);
		expect(await deviceIds(tools.id)).toEqual([sandbox.deviceId, "studio"]);

		const document = await documents.open(sandbox.spaceId);
		const changes: number[] = [];
		const count = () => changes.push(1);
		document.doc.on("update", count);
		expect(
			await projects.setClones(sandbox.spaceId, {
				deviceId: "studio",
				deviceName: "Studio",
				projectIds: [tools.id],
			}),
		).toEqual({ added: [], removed: [] });
		document.doc.off("update", count);
		expect(changes).toEqual([]);
		// Another Device's Clones stay as they are.
		expect(await deviceIds(app.id)).toEqual([sandbox.deviceId]);
	});

	test("setClones is refused in a Space a Host keeps", async () => {
		const team = await otherSpace(sandbox.db, "Team");
		const replica = keptElsewhere(team);
		try {
			await expect(
				projectsOf(replica).setClones(team, {
					deviceId: "studio",
					deviceName: "Studio",
					projectIds: [],
				}),
			).rejects.toThrow(PROJECT_NOT_FOUND);
		} finally {
			await replica.flush();
		}
	});

	test("clonedHere lists the Projects of a Space with a Clone on this computer, removed ones too", async () => {
		const projects = projectsOf();
		const app = await projects.add(
			{ repoPath: await repo("app") },
			sandbox.spaceId,
		);
		const tools = await projects.add(
			{ repoPath: await repo("tools") },
			sandbox.spaceId,
		);
		await projects.remove(tools.id);
		const team = await otherSpace(sandbox.db, "Team");
		await projects.add({ repoPath: await repo("other") }, team);
		// Another Device's row (from a Space move) is not this computer's.
		await sandbox.db.insert(device).values({
			id: "studio",
			name: "Studio",
			platform: "linux",
		});
		await sandbox.db.insert(clone).values({
			id: "row-studio",
			spaceId: sandbox.spaceId,
			projectId: app.id,
			deviceId: "studio",
			path: "/elsewhere/app",
		});
		expect((await projects.clonedHere(sandbox.spaceId)).sort()).toEqual(
			[app.id, tools.id].sort(),
		);
	});

	test("forgetDevice removes a Device's Clones and its name from the Spaces kept here", async () => {
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

		await projects.forgetDevice("studio");
		expect(
			(await projects.clones(sandbox.spaceId, app.id)).map((c) => c.deviceId),
		).toEqual([sandbox.deviceId]);
		expect(
			await sandbox.db.select().from(clone).where(eq(clone.deviceId, "studio")),
		).toEqual([]);
		// A Device the documents never knew: nothing changes.
		await projects.forgetDevice("unknown");
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
					folder: true,
					createdAt: 1,
					removedAt: null,
				},
				{
					id: "lib",
					name: "lib",
					remote: null,
					folder: true,
					createdAt: 2,
					removedAt: null,
				},
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
						folder: true,
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
				{
					id: "lib",
					name: "lib",
					remote: null,
					folder: false,
					createdAt: 2,
					removedAt: null,
				},
			],
		});

		// Oldest first: lib is older. A merge and a split carry its folder.
		expect(
			(await projects.ofSpace(sandbox.spaceId)).map((p) => [
				p.id,
				p.clone,
				p.walked,
				p.folder,
			]),
		).toEqual([
			["lib", false, false, false],
			[app.id, true, false, true],
		]);
		expect(
			(
				await projects.matching({
					ids: ["lib"],
					remotes: ["github.com/acme/app"],
				})
			)
				.map((p) => [p.id, p.folder])
				.sort(),
		).toEqual(
			[
				[app.id, true],
				["lib", false],
			].sort(),
		);
		expect(await projects.matching({})).toEqual([]);
	});
});
