import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { clone, event } from "@nightshift/db/schema";
import { asc, eq } from "drizzle-orm";
import { type DeviceDirectory, NIGHT_SHIFT } from "../contract";
import { createSpaceDocuments, type SpaceDocuments } from "../documents";
import { createRunLog } from "../log/run-log/run-log";
import { aloneDirectory } from "../testing/alone-directory";
import {
	createSandbox,
	mustGit,
	otherSpace,
	type Sandbox,
} from "../testing/test-support";
import { wireEngineProjects } from "../wire-projects";
import type { HostRelay } from "./catalog";
import { HOSTED_NEEDS_REMOTE } from "./catalog/domain/words";
import type { ListedProject } from "./keep";
import { withoutFolderOf } from "./keep/adapters/out/drizzle-project-store";

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

/**
 * The Projects as the engine wires them (`wire-projects.ts`), with the
 * person's requests of the catalog under the names these tests use: each
 * answers with the project's row, read again after the request.
 */
function projectsOf(
	over: SpaceDocuments = documents,
	more: { directory?: Partial<DeviceDirectory>; relay?: HostRelay } = {},
) {
	const { projects, catalog } = wireEngineProjects({
		db: sandbox.db,
		log: createRunLog(sandbox.db, {
			walkerId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		}),
		documents: over,
		directory: { ...aloneDirectory(sandbox.db), ...more.directory },
		hosts: more.relay,
		options: {},
		access: { openSpace: async () => {} },
		startHolds: () => ({ start: (_spaceId, work) => work() }),
		runner: () => ({ isActive: () => false }),
	});
	/** The project's row, with its folder here. */
	const here = async (projectId: string, spaceId: string) =>
		(await projects.find(projectId, spaceId)) as ListedProject & {
			repoPath: string;
		};
	return {
		...projects,
		add: async (input: { repoPath: string; name?: string }, spaceId: string) =>
			here(
				(await catalog.addProject(NIGHT_SHIFT, { ...input, spaceId })).id,
				spaceId,
			),
		useFolder: async (projectId: string, repoPath: string, spaceId: string) =>
			here(
				(
					await catalog.useProjectFolder(NIGHT_SHIFT, {
						spaceId,
						projectId,
						repoPath,
					})
				).id,
				spaceId,
			),
		addWithoutFolder: async (input: { name: string }, spaceId: string) =>
			projects.find(
				(
					await catalog.addProjectWithoutFolder(NIGHT_SHIFT, {
						...input,
						spaceId,
					})
				).id,
				spaceId,
			),
		remove: async (projectId: string) =>
			catalog.removeProject(NIGHT_SHIFT, {
				spaceId: (await projects.spaceOf(projectId)) ?? "",
				projectId,
			}),
		get: (projectId: string) => projects.find(projectId),
	};
}

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
});

describe("the folder of a project", () => {
	test("is the one of its Clone here, in its own Space only", async () => {
		const path = await repo("app");
		const projects = projectsOf();
		const { id } = await projects.add({ repoPath: path }, sandbox.spaceId);
		expect(await projects.clonePath(id, sandbox.spaceId)).toBe(path);
		const other = await otherSpace(sandbox.db);
		expect(await projects.clonePath(id, other)).toBeNull();
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
		const projects = projectsOf(replica, {
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
		expect(document.devices.has("studio")).toBe(true);
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

		// A Device that is gone: its Clones and its name go.
		await projects.forgetDevice("studio");
		expect(await deviceIds(tools.id)).toEqual([sandbox.deviceId]);
		expect(document.devices.has("studio")).toBe(false);
	});
});
