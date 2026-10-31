import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type Flow,
	flowSchema,
	parsedFlows,
	profileSchema,
	type Schedule,
} from "@nightshift/flows";
import * as Y from "yjs";
import type { ProfileStore } from "../device-config";
import { createProfileStore } from "../device-config/profiles";
import { systemGit } from "../projects";
import { createSandbox, mustGit, type Sandbox } from "../testing/test-support";
import {
	createFlowDocuments,
	type FlowDocument,
	type FlowDocuments,
	flowIdOf,
	flowNotices,
	flowRevisions,
	flowSources,
	marked,
	readSchedules,
	saveFlow,
} from "./flow-document";
import { createFlowMigrations } from "./flow-migration";
import { type CloneImport, importClone, importMarker } from "./import";
import { trackedState } from "./legacy-folder";

/** A flow of one Command node that says `word`, and calls `calls` after it when given. */
function flow(word: string, calls?: string): Flow {
	return flowSchema.parse({
		version: 7,
		inputs: [],
		outputs: [],
		start: "say",
		nodes: [
			{
				id: "say",
				type: "command",
				position: { x: 0, y: 0 },
				command: `echo ${word}`,
				output: "text",
			},
			...(calls
				? [
						{
							id: "next",
							type: "call",
							position: { x: 0, y: 100 },
							flow: calls,
							inputs: {},
						},
					]
				: []),
		],
		edges: calls ? [{ id: "e", from: "say", outcome: "pass", to: "next" }] : [],
	});
}

const nightly: Schedule = {
	id: "nightly",
	flow: "build",
	inputs: {},
	cron: "0 22 * * *",
	enabled: true,
};

const builder = profileSchema.parse({
	name: "builder",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
});

/** Writes a `.nightshift/` folder into the Clone, as Night Shift before ADR 2 kept it. */
async function writeFolder(
	repoPath: string,
	content: {
		flows?: Record<string, unknown>;
		schedules?: Schedule[];
		profiles?: unknown[];
		other?: Record<string, string>;
	},
): Promise<void> {
	const root = join(repoPath, ".nightshift");
	await mkdir(join(root, "flows"), { recursive: true });
	for (const [name, json] of Object.entries(content.flows ?? {})) {
		await writeFile(
			join(root, "flows", `${name}.json`),
			typeof json === "string" ? json : JSON.stringify(json, null, "\t"),
		);
	}
	if (content.schedules) {
		await writeFile(
			join(root, "schedules.json"),
			JSON.stringify({ version: 1, schedules: content.schedules }),
		);
	}
	if (content.profiles) {
		await writeFile(
			join(root, "profiles.json"),
			JSON.stringify({ version: 1, profiles: content.profiles }),
		);
	}
	for (const [path, text] of Object.entries(content.other ?? {})) {
		await writeFile(join(root, path), text);
	}
}

async function commit(repoPath: string, paths: string[]): Promise<void> {
	await mustGit(repoPath, ["add", ...paths]);
	await mustGit(repoPath, [
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@nightshift.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-q",
		"-m",
		"flows",
	]);
}

/** One Device: its database, its flow documents and its profiles. */
type Replica = {
	sandbox: Sandbox;
	documents: FlowDocuments;
	profiles: ProfileStore;
	document(): Promise<FlowDocument>;
	/** Imports its Clone, the Clone `clone-<n>` of this Device. */
	importClone(cloneId?: string): Promise<CloneImport>;
	/** Closes the documents and opens them again from the Replica, as a new start does. */
	restart(): Promise<void>;
	dispose(): Promise<void>;
};

const projectId = "project";

async function replica(name: string): Promise<Replica> {
	const sandbox = await createSandbox();
	let documents = createFlowDocuments({ db: sandbox.db });
	const profiles = createProfileStore({
		document: await sandbox.openDocument(),
	});
	return {
		sandbox,
		get documents() {
			return documents;
		},
		profiles,
		document: () => documents.open(projectId),
		importClone: async (cloneId = `clone-${name}`) =>
			importClone({
				document: await documents.open(projectId),
				clone: { id: cloneId, repoPath: sandbox.repoPath },
				device: { id: sandbox.deviceId, name },
				tracked: (repoPath, folder) =>
					trackedState(systemGit(), repoPath, folder),
				profiles,
				migration: () =>
					createFlowMigrations({
						db: sandbox.db,
						device: async () => ({ id: sandbox.deviceId, name }),
						profiles,
					}).forDevice(sandbox.deviceId),
				flush: () => documents.flush(),
				at: Date.now(),
			}),
		restart: async () => {
			await documents.flush();
			documents = createFlowDocuments({ db: sandbox.db });
		},
		dispose: async () => {
			await documents.flush();
			await sandbox.cleanup();
		},
	};
}

/** What a Link does: each side gets what the other has, both documents. */
async function sync(a: Replica, b: Replica): Promise<void> {
	const [left, right] = [await a.document(), await b.document()];
	for (const [x, y] of [
		[left.current.doc, right.current.doc],
		[left.history.doc, right.history.doc],
	] as const) {
		Y.applyUpdate(y, Y.encodeStateAsUpdate(x, Y.encodeStateVector(y)), "link");
		Y.applyUpdate(x, Y.encodeStateAsUpdate(y, Y.encodeStateVector(x)), "link");
	}
}

async function flowsOf(device: Replica): Promise<Record<string, Flow | null>> {
	return parsedFlows(flowSources(await device.document()));
}

async function noticesOf(device: Replica): Promise<string[]> {
	return flowNotices(await device.document()).map((notice) => notice.message);
}

const folderOf = (device: Replica) =>
	join(device.sandbox.repoPath, ".nightshift");

describe("the import on upgrade", () => {
	let laptop: Replica;
	let desktop: Replica;

	beforeEach(async () => {
		laptop = await replica("laptop");
		desktop = await replica("desktop");
	});

	afterEach(async () => {
		await laptop.dispose();
		await desktop.dispose();
	});

	test("a folder git does not track comes in, each flow with an import revision, and then goes", async () => {
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build"), night: flow("night", "build") },
			schedules: [nightly],
			profiles: [builder],
		});

		const result = await laptop.importClone();

		expect(result).toMatchObject({
			status: "imported",
			flows: ["build", "night"],
			profiles: ["builder"],
			deleted: true,
		});
		expect(existsSync(folderOf(laptop))).toBe(false);
		expect(await flowsOf(laptop)).toEqual({
			build: flow("build"),
			night: flow("night", "build"),
		});
		const document = await laptop.document();
		expect(readSchedules(document).schedules).toEqual([nightly]);
		const flowId = flowIdOf(document, "build") as string;
		expect(flowRevisions(document, flowId)).toEqual([
			expect.objectContaining({
				kind: "import",
				personId: null,
				deviceId: laptop.sandbox.deviceId,
			}),
		]);
		expect(marked(document, importMarker("clone-laptop"))).toBe(true);
		expect(laptop.profiles.get("builder")).toMatchObject({
			id: "builder",
			name: "builder",
			model: "sonnet",
		});
		expect(await noticesOf(laptop)).toEqual([
			"Night Shift made this profile on laptop from the project's profiles: builder.",
		]);
	});

	test("a folder git tracks comes in and stays, with a notice to remove it in a commit", async () => {
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
		});
		await commit(laptop.sandbox.repoPath, [".nightshift"]);

		const result = await laptop.importClone();

		expect(result).toMatchObject({ status: "imported", deleted: false });
		expect(existsSync(join(folderOf(laptop), "flows", "build.json"))).toBe(
			true,
		);
		expect(Object.keys(await flowsOf(laptop))).toEqual(["build"]);
		expect(await noticesOf(laptop)).toEqual([
			"Night Shift imported the .nightshift folder on laptop. Git tracks that folder, so Night Shift left it in place. Remove it in a commit.",
		]);
	});

	test("a folder git tracks part of comes in and stays, with a notice", async () => {
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
		});
		await commit(laptop.sandbox.repoPath, [".nightshift"]);
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { night: flow("night") },
		});

		const result = await laptop.importClone();

		expect(result).toMatchObject({ status: "imported", deleted: false });
		expect(existsSync(join(folderOf(laptop), "flows", "night.json"))).toBe(
			true,
		);
		expect(Object.keys(await flowsOf(laptop))).toEqual(["build", "night"]);
		expect(await noticesOf(laptop)).toEqual([
			"Night Shift imported the .nightshift folder on laptop. Git tracks part of that folder, so Night Shift left it in place. Remove it in a commit.",
		]);
	});

	test("a folder that is not all valid, or that holds other files, stays: what is valid comes in", async () => {
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build"), broken: "{ not json" },
			other: { "notes.txt": "mine" },
		});

		const result = await laptop.importClone();

		expect(result).toMatchObject({
			status: "imported",
			flows: ["build"],
			deleted: false,
		});
		expect(existsSync(join(folderOf(laptop), "notes.txt"))).toBe(true);
		expect(existsSync(join(folderOf(laptop), "flows", "build.json"))).toBe(
			true,
		);
		expect(await noticesOf(laptop)).toEqual([
			'Night Shift could not import all of the .nightshift folder on laptop, so it left the folder in place. The folder holds other files. The flow "broken" is not valid. Check those files, then remove the folder.',
		]);
	});

	test("a folder git cannot check stays", async () => {
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
		});
		const result = await importClone({
			document: await laptop.document(),
			clone: { id: "clone-laptop", repoPath: laptop.sandbox.repoPath },
			device: { id: laptop.sandbox.deviceId, name: "laptop" },
			tracked: async () => {
				throw new Error("git is gone");
			},
			flush: () => laptop.documents.flush(),
			at: Date.now(),
		});

		expect(result).toMatchObject({ status: "imported", deleted: false });
		expect(existsSync(join(folderOf(laptop), "flows", "build.json"))).toBe(
			true,
		);
		expect(await noticesOf(laptop)).toEqual([
			"Night Shift imported the .nightshift folder on laptop. Night Shift could not check the folder with git, so it left it in place. Remove the folder when you no longer need it.",
		]);
	});

	test("a folder stays when the documents do not flush", async () => {
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
		});
		const failed = importClone({
			document: await laptop.document(),
			clone: { id: "clone-laptop", repoPath: laptop.sandbox.repoPath },
			device: { id: laptop.sandbox.deviceId, name: "laptop" },
			tracked: (repoPath, folder) =>
				trackedState(systemGit(), repoPath, folder),
			flush: async () => {
				throw new Error("The disk is full.");
			},
			at: Date.now(),
		});

		await expect(failed).rejects.toThrow("The disk is full.");
		expect(existsSync(join(folderOf(laptop), "flows", "build.json"))).toBe(
			true,
		);
	});

	test("a flow of the same name and another content comes in with a suffix, and its callers and schedules follow it", async () => {
		await desktop.importClone();
		await writeFolder(desktop.sandbox.repoPath, {
			flows: { build: flow("desktop") },
		});
		await desktop.importClone("clone-desktop-2");
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("laptop"), night: flow("night", "build") },
			schedules: [nightly],
		});
		await sync(laptop, desktop);

		const result = await laptop.importClone();

		expect(result).toMatchObject({
			status: "imported",
			flows: ["build-2", "night"],
			renamed: { build: "build-2" },
		});
		expect(await flowsOf(laptop)).toEqual({
			build: flow("desktop"),
			"build-2": flow("laptop"),
			night: flow("night", "build-2"),
		});
		expect(readSchedules(await laptop.document()).schedules).toEqual([
			{ ...nightly, flow: "build-2" },
		]);
		expect(await noticesOf(laptop)).toEqual([
			'Two flows are named "build". Night Shift imported the one from laptop as "build-2".',
		]);
	});

	test("a flow and a schedule of the same content come in once", async () => {
		await writeFolder(desktop.sandbox.repoPath, {
			flows: { build: flow("build") },
			schedules: [nightly],
		});
		await desktop.importClone();
		await sync(laptop, desktop);
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
			schedules: [nightly],
		});

		const result = await laptop.importClone();

		expect(result).toMatchObject({ status: "imported", flows: [] });
		const document = await laptop.document();
		expect(await flowsOf(laptop)).toEqual({ build: flow("build") });
		expect(readSchedules(document).schedules).toEqual([nightly]);
		const flowId = flowIdOf(document, "build") as string;
		expect(flowRevisions(document, flowId)).toHaveLength(1);
		expect(await noticesOf(laptop)).toEqual([]);
	});

	test("a schedule of the same id and another content comes in with a suffix", async () => {
		await writeFolder(desktop.sandbox.repoPath, {
			flows: { build: flow("build") },
			schedules: [nightly],
		});
		await desktop.importClone();
		await sync(laptop, desktop);
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
			schedules: [{ ...nightly, cron: "0 6 * * *" }],
		});

		await laptop.importClone();

		expect(readSchedules(await laptop.document()).schedules).toEqual([
			nightly,
			{ ...nightly, id: "nightly-2", cron: "0 6 * * *" },
		]);
		expect(await noticesOf(laptop)).toEqual([
			'Two schedules are named "nightly". Night Shift imported the one from laptop as "nightly-2".',
		]);
	});

	test("a restart does not import the Clone again", async () => {
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
		});
		await commit(laptop.sandbox.repoPath, [".nightshift"]);
		await laptop.importClone();
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { night: flow("night") },
		});

		await laptop.restart();
		const result = await laptop.importClone();

		expect(result).toEqual({ status: "already" });
		expect(Object.keys(await flowsOf(laptop))).toEqual(["build"]);
		expect(await noticesOf(laptop)).toHaveLength(1);
		expect(existsSync(join(folderOf(laptop), "flows", "night.json"))).toBe(
			true,
		);
	});

	test("a Clone without a folder is done: a folder that comes later stays unread", async () => {
		expect(await laptop.importClone()).toEqual({ status: "no-folder" });
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
		});

		expect(await laptop.importClone()).toEqual({ status: "already" });
		expect(await flowsOf(laptop)).toEqual({});
	});

	test("two Devices that import the same folder before they sync keep one flow", async () => {
		for (const device of [laptop, desktop]) {
			await writeFolder(device.sandbox.repoPath, {
				flows: { build: flow("build") },
			});
			await device.importClone();
		}

		await sync(laptop, desktop);

		for (const device of [laptop, desktop]) {
			expect(await flowsOf(device)).toEqual({ build: flow("build") });
		}
	});

	test("two Devices that import different flows of one name before they sync keep both", async () => {
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("laptop") },
		});
		await laptop.importClone();
		await Bun.sleep(5);
		await writeFolder(desktop.sandbox.repoPath, {
			flows: { build: flow("desktop") },
		});
		await desktop.importClone();

		await sync(laptop, desktop);

		for (const device of [laptop, desktop]) {
			expect(await flowsOf(device)).toEqual({
				build: flow("laptop"),
				"build-2": flow("desktop"),
			});
		}
	});

	test("a save of a flow that two Devices imported removes the copy, so it does not come back", async () => {
		for (const device of [laptop, desktop]) {
			await writeFolder(device.sandbox.repoPath, {
				flows: { build: flow("build") },
			});
			await device.importClone();
		}
		await sync(laptop, desktop);

		await saveFlow(await laptop.document(), {
			name: "build",
			flow: flow("changed"),
			kind: "save",
			personId: "person",
			deviceId: laptop.sandbox.deviceId,
			at: Date.now(),
		});
		await sync(laptop, desktop);

		for (const device of [laptop, desktop]) {
			expect(await flowsOf(device)).toEqual({ build: flow("changed") });
		}
	});

	test("a project profile whose name the Device has comes in under another name, and the flows keep the Device's own", async () => {
		const own = await laptop.profiles.save({ ...builder, model: "opus" });
		await writeFolder(laptop.sandbox.repoPath, {
			flows: { build: flow("build") },
			profiles: [builder, { ...builder, name: "triage" }],
		});

		const result = await laptop.importClone();

		expect(result).toMatchObject({ profiles: ["triage"] });
		expect(laptop.profiles.byName("builder")?.id).toBe(own.id);
		const copy = laptop.profiles.byName("builder_project");
		expect(copy).toMatchObject({ model: "sonnet" });
		expect(copy?.id).toStartWith("p-");
		expect(laptop.profiles.get("triage")?.name).toBe("triage");
		expect(await noticesOf(laptop)).toEqual([
			"Night Shift made this profile on laptop from the project's profiles: triage.",
			'laptop already has a profile named "builder". The project\'s profile is now "builder_project". The flows still use the profile of laptop.',
		]);
	});

	test("a flow of format 6 comes in naming this Device's profiles by id, its own one on a clash", async () => {
		const own = await laptop.profiles.save({ ...builder, model: "opus" });
		const agent = (id: string, profile: string, device?: string) => ({
			id,
			type: "agent",
			position: { x: 0, y: 0 },
			prompt: "Work.",
			profile,
			...(device ? { device } : {}),
		});
		await writeFolder(laptop.sandbox.repoPath, {
			flows: {
				build: {
					version: 6,
					start: "build",
					nodes: [
						agent("build", "builder"),
						agent("check", "triage"),
						agent("far", "builder", "hetzner-1"),
					],
					edges: [],
				},
			},
			profiles: [builder, { ...builder, name: "triage" }],
		});

		await laptop.importClone();

		const nodes = (await flowsOf(laptop)).build?.nodes ?? [];
		expect(
			nodes.map((node) => ("profile" in node ? node.profile : null)),
		).toEqual([
			{ device: laptop.sandbox.deviceId, profile: own.id },
			{ device: laptop.sandbox.deviceId, profile: "triage" },
			// No Device of that name: the node keeps the name, to pick again.
			"builder",
		]);
	});

	test("a project profile the Device has with the same settings comes in once", async () => {
		const own = await laptop.profiles.save(builder);
		await writeFolder(laptop.sandbox.repoPath, { profiles: [builder] });

		await laptop.importClone();

		expect(laptop.profiles.list().map((profile) => profile.id)).toEqual([
			own.id,
		]);
		expect(await noticesOf(laptop)).toEqual([]);
	});
});
