import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Flow, flowSchema, type Schedule } from "@nightshift/flows";
import type { SpaceEngine } from "../run";
import { createEngine, type Engine } from "../run";
import { testKnowledge } from "../testing/knowledge";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { knowledgeSourceProblems, knowledgeSources } from "./sources";

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
	return knowledgeSources({
		space,
		files: built.knowledge,
		// The test Device's name.
		deviceName: "test",
	});
}

const callFlow = (kit: string, inputs: Record<string, string>): Flow =>
	flowSchema.parse({
		version: 7,
		start: "sync",
		nodes: [
			{ id: "sync", type: "call", position: { x: 0, y: 0 }, flow: kit, inputs },
		],
		edges: [],
	});

/** A flow that calls a kit and does more: one the editor drew, not the page. */
const drawnFlow = (kit: string, inputs: Record<string, string> = {}): Flow =>
	flowSchema.parse({
		version: 7,
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
		({ id, flow, inputs, cron, enabled, device, webhook }) => ({
			id,
			flow,
			inputs,
			enabled,
			...(cron !== undefined ? { cron } : {}),
			...(device !== undefined ? { device } : {}),
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
		expect((await schedules())[0]?.device).toBeUndefined();
		expect((await flows())["knowledge-folder"]?.nodes[0]).toMatchObject({
			inputs: { path: "~/notes", folder: "folder" },
			device: "test",
		});
		// Edited on another computer, it stays on the one that has the folder.
		await knowledgeSources({
			space,
			files: built.knowledge,
			deviceName: "laptop",
		}).save(
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
			device: "test",
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

	test("an older folder source, pinned by its schedule, moves over to its Subflow on its next edit", async () => {
		await space.flows.save(
			projectId,
			"knowledge-folder",
			callFlow("kit:knowledge/folder", { path: "~/notes", folder: "folder" }),
		);
		await space.saveSchedules(projectId, [
			{
				id: "knowledge-folder",
				flow: "knowledge-folder",
				inputs: {},
				cron: "0 6 * * *",
				enabled: true,
				device: "studio",
			},
		]);
		await sources().save(
			projectId,
			{
				name: "knowledge-folder",
				source: { kit: "kit:knowledge/folder", inputs: { path: "~/notes" } },
				keepUpToDate: { cron: "0 7 * * *" },
			},
			owner,
		);
		expect((await flows())["knowledge-folder"]?.nodes[0]).toMatchObject({
			device: "studio",
		});
		expect((await schedules())[0]).toMatchObject({ cron: "0 7 * * *" });
		expect((await schedules())[0]?.device).toBeUndefined();
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
		const listed = await sources().list(projectId);
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
				schedule: { cron: "0 6 * * *", enabled: true },
				lastRun: null,
				health: null,
			},
		]);
		expect(listed.reviews).toEqual(["review"]);
		expect(listed.proposed).toBe(0);
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
		await sources().list(projectId);
		expect(
			await sources().remove(projectId, one.name, { files: true }, owner),
		).toEqual({ removedFiles: 2 });
		expect(await flows()).toEqual({});
		expect(await schedules()).toEqual([]);
		expect((await sources().list(projectId)).files).toEqual([]);

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
		await sources().list(projectId);
		expect(
			await sources().remove(projectId, two.name, { files: true }, owner),
		).toEqual({ removedFiles: 0 });
		expect((await sources().list(projectId)).files).toHaveLength(1);
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
		await sources().list(projectId);
		// Someone who may not change this computer's schedules.
		await expect(
			sources().remove(projectId, one.name, { files: true }, member),
		).rejects.toThrow("Only the owner of this computer");
		// A run writes the knowledge now.
		const step = await built.knowledge.forCommand({ projectId });
		await expect(
			sources().remove(projectId, one.name, { files: true }, owner),
		).rejects.toThrow("A run is changing this knowledge now");
		await step.done();
		expect(Object.keys(await flows())).toEqual([one.name]);
		expect(await schedules()).toHaveLength(1);
		expect((await sources().list(projectId)).files).toHaveLength(1);
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
		expect((await sources().list(projectId)).files.map((f) => f.path)).toEqual([
			"folder/a.md",
		]);
	});
});

describe("the sources that need a person", () => {
	const DAY = 24 * 60 * 60_000;
	const now = 100 * DAY;
	/** A Space as the digest reads it: one project, these flows, these runs. */
	function spaceWith(
		runs: { flowName: string; status: string; endedAt: number | null }[],
	) {
		const flows: Record<string, Flow> = {
			"knowledge-jira": callFlow("kit:knowledge/jira", { keys: "A-1" }),
			web: drawnFlow("kit:knowledge/web"),
			wiki: drawnFlow("kit:knowledge/github-wiki"),
			fresh: drawnFlow("kit:knowledge/files"),
			review: callFlow("kit:knowledge/review-learnings", {}),
		};
		return {
			listProjects: async () => [{ id: "p1", name: "Lighthouse" }],
			flows: { map: async () => flows },
			listRuns: async () =>
				runs.map((run, index) => ({
					...run,
					id: `run-${index}`,
					createdAt: now - 30 * DAY,
				})),
		} as unknown as Parameters<typeof knowledgeSourceProblems>[0];
	}

	test("a failed last sync, and one that ended more than a week ago; not one that runs or synced lately", async () => {
		const problems = await knowledgeSourceProblems(
			spaceWith([
				{ flowName: "knowledge-jira", status: "failed", endedAt: now - DAY },
				{ flowName: "web", status: "finished", endedAt: now - 8 * DAY },
				{ flowName: "wiki", status: "running", endedAt: null },
				{ flowName: "fresh", status: "finished", endedAt: now - DAY },
				{ flowName: "review", status: "failed", endedAt: now - DAY },
				// An older run of a flow: its latest run counts.
				{ flowName: "fresh", status: "failed", endedAt: now - 9 * DAY },
			]),
			now,
		);
		expect(problems).toEqual([
			{
				projectId: "p1",
				projectName: "Lighthouse",
				flow: "knowledge-jira",
				label: "Jira",
				health: "failed",
				lastRun: { id: "run-0", status: "failed", at: now - DAY },
			},
			{
				projectId: "p1",
				projectName: "Lighthouse",
				flow: "web",
				label: "web",
				health: "stale",
				lastRun: { id: "run-1", status: "finished", at: now - 8 * DAY },
			},
		]);
	});
});
