import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	type Schedule,
} from "@nightshift/flows";
import type { SpaceEngine } from "../run";
import { createEngine, type Engine } from "../run";
import { testKnowledge } from "../testing/knowledge";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { knowledgeSources } from "./sources";

/**
 * Knowledge sources over a real Space: the flows, schedules and files a
 * source is, as the Knowledge page saves, lists and removes them.
 */

let sandbox: Sandbox;
let root: Engine;
let space: SpaceEngine;
let projectId: string;
let built: ReturnType<typeof testKnowledge>;

const owner = { schedules: true };
const member = { schedules: false };
/** A role that may do everything with a source. */
const all = { save: true, remove: true, startRuns: true, schedules: true };

beforeEach(async () => {
	sandbox = await createSandbox();
	built = testKnowledge(sandbox, { pageWaitMs: 5_000 });
	root = createEngine(
		withDevice({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			harnesses: {},
			knowledge: built.knowledge,
		}),
	);
	space = root.space(sandbox.spaceId);
	({ id: projectId } = await space.addProject({ repoPath: sandbox.repoPath }));
});
afterEach(async () => {
	built.close();
	await root.dispose();
	await sandbox.cleanup();
});

function sources() {
	return built.knowledge.sources(space);
}

/** The sources in `view` as another computer sees them. */
function sourcesOn(
	device: { id: string; name: string },
	view: SpaceEngine = space,
) {
	return knowledgeSources({
		space: view,
		files: {
			listing: built.knowledge.listing,
			removeFolder: async () => 0,
		},
		device,
	});
}

const callFlow = (kit: string, inputs: Record<string, string>): Flow =>
	flowSchema.parse({
		version: FLOW_VERSION,
		start: "sync",
		nodes: [
			{ id: "sync", type: "call", position: { x: 0, y: 0 }, flow: kit, inputs },
		],
		edges: [],
	});

/** A flow that calls a kit and does more: one the editor drew, not the page. */
const drawnFlow = (kit: string, inputs: Record<string, string> = {}): Flow =>
	flowSchema.parse({
		version: FLOW_VERSION,
		start: "sync",
		nodes: [
			{ id: "sync", type: "call", position: { x: 0, y: 0 }, flow: kit, inputs },
			{ id: "end", type: "end", position: { x: 1, y: 1 }, status: "done" },
		],
		edges: [{ id: "e", from: "sync", outcome: "synced", to: "end" }],
	});

const flows = () => space.flows.map(projectId);
const schedules = async (): Promise<Schedule[]> =>
	(await space.listSchedules(projectId)).schedules.map(
		({ id, flow, inputs, cron, enabled, webhook }) => ({
			id,
			flow,
			inputs,
			enabled,
			...(cron !== undefined ? { cron } : {}),
			...(webhook !== undefined ? { webhook } : {}),
		}),
	);

async function putFile(path: string, text: string) {
	const abs = join(built.folder(projectId), path);
	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, text);
}

describe("save", () => {
	test("adds a source as a flow that calls the kit, with its own folder and a schedule", async () => {
		await space.flows.save(
			projectId,
			"sync",
			callFlow("kit:knowledge/web", { urls: "https://example.com" }),
		);
		const saved = await sources().save(
			projectId,
			{
				source: {
					kit: "kit:knowledge/web",
					inputs: { urls: " https://example.org ", folder: "" },
				},
				keepUpToDate: { cron: "0 6 * * *" },
				timeZone: "Europe/Amsterdam",
			},
			owner,
		);
		expect(saved).toEqual({ name: "knowledge-web-pages", issues: [] });
		const flow = (await flows())["knowledge-web-pages"];
		expect(flow?.description).toBe(
			"Knowledge: Web pages. Edit it on the Knowledge page.",
		);
		// The other web sync fills web: this one gets a folder of its own.
		expect(flow?.nodes[0]).toMatchObject({
			type: "call",
			flow: "kit:knowledge/web",
			inputs: { urls: "https://example.org", folder: "web-2" },
		});
		expect(await schedules()).toEqual([
			{
				id: "knowledge-web-pages",
				flow: "knowledge-web-pages",
				inputs: {},
				cron: "0 6 * * *",
				enabled: true,
			},
		]);
	});

	test("a folder of this computer syncs on this computer: its Subflow names it, whoever starts the run", async () => {
		await sources().save(
			projectId,
			{
				source: { kit: "kit:knowledge/folder", inputs: { path: "~/notes" } },
				keepUpToDate: { cron: "0 6 * * *" },
			},
			owner,
		);
		expect((await flows())["knowledge-folder"]?.nodes[0]).toMatchObject({
			inputs: { path: "~/notes", folder: "folder" },
			device: sandbox.deviceId,
		});
		// Edited on another computer, it stays on the one that has the folder.
		await sourcesOn({ id: "laptop-id", name: "laptop" }).save(
			projectId,
			{
				name: "knowledge-folder",
				source: {
					kit: "kit:knowledge/folder",
					inputs: { path: "~/notes", patterns: "*.md" },
				},
			},
			owner,
		);
		expect((await flows())["knowledge-folder"]?.nodes[0]).toMatchObject({
			device: sandbox.deviceId,
		});
		// The list names the computer by its id, and whether it is this one.
		// A person's Devices name it: the Subflow keeps its id.
		const computer = async (device: { id: string; name: string }) =>
			(
				await sourcesOn(
					device,
					root.space(sandbox.spaceId, { personId: "ada" }),
				).list(projectId, all)
			).syncs.find((sync) => sync.flow === "knowledge-folder")?.computer;
		expect(await computer({ id: sandbox.deviceId, name: "test" })).toEqual({
			name: "test",
			here: true,
		});
		expect(await computer({ id: "laptop-id", name: "laptop" })).toEqual({
			name: "test",
			here: false,
		});
		// A source of another kind runs where the run runs.
		await sources().save(
			projectId,
			{ source: { kit: "kit:knowledge/web", inputs: { urls: "a" } } },
			owner,
		);
		expect(
			(await flows())["knowledge-web-pages"]?.nodes[0] as object,
		).not.toHaveProperty("device");
	});

	test("an edit keeps the source's folder without asking for it, and its schedule's other settings", async () => {
		const first = await sources().save(
			projectId,
			{
				source: { kit: "kit:knowledge/github-wiki", inputs: { repo: "a/b" } },
				keepUpToDate: { cron: "0 6 * * *" },
			},
			owner,
		);
		// A webhook of the flow, and a stop time the person set elsewhere.
		const hook: Schedule = {
			id: "hook",
			flow: first.name,
			inputs: {},
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
			webhook: { secret: "${HOOK}" },
			enabled: true,
		};
		await space.saveSchedules(projectId, [...(await schedules()), hook]);
		await sources().save(
			projectId,
			{
				name: first.name,
				source: { kit: "kit:knowledge/github-wiki", inputs: { repo: "c/d" } },
				keepUpToDate: { cron: "0 7 * * 1-5" },
			},
			owner,
		);
		expect(Object.keys(await flows())).toEqual(["knowledge-github-wiki"]);
		expect((await flows())["knowledge-github-wiki"]?.nodes[0]).toMatchObject({
			inputs: { repo: "c/d", folder: "wiki" },
		});
		expect(await schedules()).toEqual([
			{
				id: "knowledge-github-wiki",
				flow: "knowledge-github-wiki",
				inputs: {},
				cron: "0 7 * * 1-5",
				enabled: true,
			},
			hook,
		]);
	});

	test("refuses a flow the page did not make, missing values, a folder that is not its own, and a schedule from someone else", async () => {
		await space.flows.save(projectId, "drawn", drawnFlow("kit:knowledge/web"));
		const save = (
			inputs: Record<string, string>,
			more: { name?: string; keepUpToDate?: { cron: string } } = {},
		) =>
			sources().save(
				projectId,
				{ source: { kit: "kit:knowledge/folder", inputs }, ...more },
				member,
			);
		await expect(save({ path: "/x" }, { name: "drawn" })).rejects.toThrow(
			"This project has no such source.",
		);
		await expect(save({ path: " " })).rejects.toThrow("Fill in Folder.");
		await expect(save({ path: "/x", folder: "web" })).rejects.toThrow(
			"Another source fills the folder web.",
		);
		await expect(save({ path: "/x", folder: "learnings" })).rejects.toThrow(
			"Choose a folder inside the knowledge",
		);
		await expect(save({ path: "/x", folder: "evals" })).rejects.toThrow(
			"learnings and evals are Night Shift's own.",
		);
		await expect(save({ path: "/x", folder: "evals/q" })).rejects.toThrow(
			"Choose a folder inside the knowledge",
		);
		await expect(save({ path: "/x", folder: "../up" })).rejects.toThrow(
			"Choose a folder inside the knowledge",
		);
		await expect(save({ path: "/notes/{{x}}" })).rejects.toThrow(
			"Folder cannot contain {{. Remove it.",
		);
		await expect(save({ path: "/x", nope: "1" })).rejects.toThrow(
			'This source has no field "nope".',
		);
		await expect(
			save({ path: "/x" }, { keepUpToDate: { cron: "0 6 * * *" } }),
		).rejects.toThrow("Only the owner of this computer");
		await expect(
			sources().save(
				projectId,
				{
					source: { kit: "kit:knowledge/folder", inputs: { path: "/x" } },
					keepUpToDate: { cron: "every day" },
				},
				owner,
			),
		).rejects.toThrow("This schedule is not valid");
		expect(Object.keys(await flows())).toEqual(["drawn"]);
	});
});

describe("list", () => {
	test("the files, the flows that fill the knowledge or review its learnings, with their schedules", async () => {
		await sources().save(
			projectId,
			{
				source: { kit: "kit:knowledge/web", inputs: { urls: "a" } },
				keepUpToDate: { cron: "0 6 * * *" },
			},
			owner,
		);
		await space.flows.save(
			projectId,
			"review",
			callFlow("kit:knowledge/review-learnings", {}),
		);
		await putFile("web/a.md", "# A\n");
		const listed = await sources().list(projectId, all);
		expect(listed.files.map((file) => file.path)).toEqual(["web/a.md"]);
		expect(listed.tooLarge).toBe(false);
		expect(listed.syncs).toEqual([
			{
				flow: "knowledge-web-pages",
				kits: ["kit:knowledge/web"],
				source: {
					kit: "kit:knowledge/web",
					inputs: { urls: "a", folder: "web" },
				},
				computer: null,
				schedule: { cron: "0 6 * * *", enabled: true },
				lastRun: null,
				health: null,
				may: { sync: true, edit: true, remove: true, removeFiles: true },
			},
		]);
		expect(listed.reviews).toEqual(["review"]);
		expect(listed.proposed).toBe(0);
	});

	describe("what you may do with a source", () => {
		const none = {
			save: false,
			remove: false,
			startRuns: false,
			schedules: false,
		};
		/** The source's flow, with a schedule or not, then what `can` allows on it. */
		async function mayOn(
			can: typeof all,
			options: { drawn?: boolean; scheduled?: boolean } = {},
		) {
			const flow = options.drawn
				? drawnFlow("kit:knowledge/web", { urls: "a", folder: "web" })
				: callFlow("kit:knowledge/web", { urls: "a", folder: "web" });
			await space.flows.save(projectId, "web", flow);
			await space.saveSchedules(
				projectId,
				options.scheduled
					? [
							{
								id: "web",
								flow: "web",
								inputs: {},
								enabled: true,
								cron: "0 6 * * *",
							},
						]
					: [],
			);
			const { syncs } = await sources().list(projectId, can);
			return syncs.find((sync) => sync.flow === "web")?.may;
		}

		test("a viewer gets none of the actions", async () => {
			expect(await mayOn(none, { scheduled: true })).toEqual({
				sync: false,
				edit: false,
				remove: false,
				removeFiles: false,
			});
		});

		test("a Member edits and syncs, and removes a source without a schedule", async () => {
			const member = { ...all, schedules: false };
			expect(await mayOn(member)).toEqual({
				sync: true,
				edit: true,
				remove: true,
				removeFiles: true,
			});
			expect((await mayOn(member, { scheduled: true }))?.remove).toBe(false);
			expect((await mayOn(all, { scheduled: true }))?.remove).toBe(true);
		});

		test("a flow someone drew only syncs here", async () => {
			expect(await mayOn(all, { drawn: true })).toEqual({
				sync: true,
				edit: false,
				remove: false,
				removeFiles: true,
			});
		});
	});

	describe("the name of another computer", () => {
		/** The Space, with a list of Devices that may never come. */
		function viewWith(listDevices: SpaceEngine["listDevices"]): SpaceEngine {
			return new Proxy(space, {
				get: (target, name, receiver) =>
					name === "listDevices"
						? listDevices
						: Reflect.get(target, name, receiver),
			});
		}
		test("no source names another computer: the Host is not asked", async () => {
			let asked = 0;
			await space.flows.save(
				projectId,
				"web",
				callFlow("kit:knowledge/web", { urls: "a", folder: "web" }),
			);
			const list = await sourcesOn(
				{ id: sandbox.deviceId, name: "test" },
				viewWith(async () => {
					asked++;
					return [];
				}),
			).list(projectId, all);
			expect(list.syncs.map((sync) => sync.computer)).toEqual([null]);
			expect(asked).toBe(0);
		});

		test("a Host that does not answer in time names none, and the page does not wait for it", async () => {
			await sources().save(
				projectId,
				{
					source: {
						kit: "kit:knowledge/folder",
						inputs: { path: "~/notes", folder: "notes" },
					},
				},
				owner,
			);
			const never = new Promise<never>(() => {});
			const list = await sourcesOn(
				{ id: "laptop-id", name: "laptop" },
				viewWith(() => never),
			).list(projectId, all);
			expect(list.syncs.map((sync) => sync.computer)).toEqual([
				{ name: "another computer", here: false },
			]);
		});
	});
});

describe("what waits on the Knowledge page", () => {
	test("the door reads the learnings and the questions agents found nothing for, in order", async () => {
		await putFile("learnings/proposed/run-1.s1.md", "- Use bun.\n");
		await sources().list(projectId, all);
		await built.knowledge.search(projectId, "gold", { agent: true });

		const tasks = await built.knowledge.review(projectId, space);
		expect(tasks.map((task) => [task.kind, task.id, task.node])).toEqual([
			["learning", "learning:run-1.s1.md", "learning:run-1.s1.md"],
			["question", "question:gold", "question:gold"],
		]);
		expect(tasks[0]).toMatchObject({
			learning: { projectId, notes: ["Use bun."] },
		});
	});
});

describe("remove", () => {
	test("removes a source's files, schedules and flow, but not a folder another flow fills", async () => {
		const one = await sources().save(
			projectId,
			{
				source: { kit: "kit:knowledge/web", inputs: { urls: "a" } },
				keepUpToDate: { cron: "0 6 * * *" },
			},
			owner,
		);
		await putFile("web/a.md", "# A\n");
		await putFile("web/b.md", "# B\n");
		await sources().list(projectId, all);
		expect(
			await sources().remove(projectId, one.name, { files: true }, owner),
		).toEqual({ removedFiles: 2 });
		expect(await flows()).toEqual({});
		expect(await schedules()).toEqual([]);
		expect((await sources().list(projectId, all)).files).toEqual([]);

		// A drawn flow fills the folder too: its files stay.
		const two = await sources().save(
			projectId,
			{ source: { kit: "kit:knowledge/web", inputs: { urls: "a" } } },
			owner,
		);
		await space.flows.save(
			projectId,
			"other",
			callFlow("kit:knowledge/web", { urls: "b", folder: "{{x}}" }),
		);
		await space.flows.save(
			projectId,
			"drawn",
			drawnFlow("kit:knowledge/files", { folder: "web" }),
		);
		await putFile("web/c.md", "# C\n");
		await sources().list(projectId, all);
		expect(
			await sources().remove(projectId, two.name, { files: true }, owner),
		).toEqual({ removedFiles: 0 });
		expect((await sources().list(projectId, all)).files).toHaveLength(1);
	});

	test("checks first and removes the files first: a refusal leaves the source as it was", async () => {
		const one = await sources().save(
			projectId,
			{
				source: { kit: "kit:knowledge/web", inputs: { urls: "a" } },
				keepUpToDate: { cron: "0 6 * * *" },
			},
			owner,
		);
		await putFile("web/a.md", "# A\n");
		await sources().list(projectId, all);
		// Someone who may not change this computer's schedules.
		await expect(
			sources().remove(projectId, one.name, { files: true }, member),
		).rejects.toThrow("Only the owner of this computer");
		// A run writes the knowledge now.
		const step = await built.knowledge.forCommand(projectId);
		await expect(
			sources().remove(projectId, one.name, { files: true }, owner),
		).rejects.toThrow("A run is changing this knowledge now");
		await step.done();
		expect(Object.keys(await flows())).toEqual([one.name]);
		expect(await schedules()).toHaveLength(1);
		expect((await sources().list(projectId, all)).files).toHaveLength(1);
		await expect(
			sources().remove(projectId, "nope", { files: false }, owner),
		).rejects.toThrow("This project has no such source.");
	});
});

describe("sync", () => {
	test("runs a folder source on the computer its Subflow names", async () => {
		const notes = join(sandbox.root, "notes");
		await mkdir(notes, { recursive: true });
		await writeFile(join(notes, "a.md"), "# A\n");
		const local = await sources().save(
			projectId,
			{
				source: { kit: "kit:knowledge/folder", inputs: { path: notes } },
				keepUpToDate: { cron: "0 6 * * *" },
			},
			owner,
		);
		const run = await sources().sync(projectId, local.name, "person-1");
		expect(run.flowName).toBe(local.name);
		expect(run.device.name).toBe("test");
		await waitFor(
			async () =>
				!["running", "waiting"].includes((await space.getRun(run.id)).status),
			{ label: "the sync to end" },
		);
		const detail = await space.getRun(run.id);
		expect(detail.status).toBe("finished");
		expect(
			(await sources().list(projectId, all)).files.map((f) => f.path),
		).toEqual(["folder/a.md"]);
	});
});
