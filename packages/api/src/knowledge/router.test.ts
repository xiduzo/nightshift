import { describe, expect, test } from "bun:test";
import type { SpaceEngine, SpaceFlows } from "@nightshift/engine";
import { type Flow, flowSchema, type Schedule } from "@nightshift/flows";
import { call, ORPCError } from "@orpc/server";

import { appRouter } from "../router";
import { accessAs, stub, testContext } from "../testing/context";

/**
 * The Knowledge page's procedures: the files of the project's knowledge in
 * its Space, the size warning and the flows that fill it, for any Member
 * of the Space (ADR 4), and search and one file.
 */

const callFlow = (kit: string, inputs: Record<string, string>): Flow =>
	flowSchema.parse({
		version: 7,
		start: "call",
		nodes: [
			{ id: "call", type: "call", position: { x: 0, y: 0 }, flow: kit, inputs },
		],
		edges: [],
	});
const syncFlow = callFlow("kit:knowledge/web", { urls: "https://example.com" });
const reviewFlow = callFlow("kit:knowledge/review-learnings", {});

function context(personId: string, files: number) {
	return testContext({
		access: accessAs({ personId, spaceId: "s1", role: "viewer" }),
		daemon: { device: { id: "d1", name: "studio", ownerId: "owner" } },
		knowledge: {
			listing: async () => ({
				files: Array.from({ length: files }, (_, i) => ({
					path: `page-${i}.md`,
					size: 10,
					changedAt: 1,
				})),
				proposed: 3,
				shared: true,
			}),
		},
		engine: {
			space: () =>
				stub<SpaceEngine>("Space view", {
					flows: stub<SpaceFlows>("flows", {
						map: async (projectId) => {
							if (projectId !== "p1") {
								throw new ORPCError("NOT_FOUND", {
									message: "This Space has no such project.",
								});
							}
							return {
								sync: syncFlow,
								"review-learnings": reviewFlow,
								broken: null,
							};
						},
					}),
					listSchedules: async () =>
						({
							path: "",
							issues: [],
							schedules: [
								{ id: "sync", flow: "sync", cron: "0 6 * * *", enabled: true },
							],
						}) as unknown as Awaited<ReturnType<SpaceEngine["listSchedules"]>>,
					listRuns: async () =>
						[
							{
								id: "r2",
								flowName: "sync",
								status: "failed",
								createdAt: 5,
								endedAt: 6,
							},
							{ id: "r1", flowName: "sync", status: "finished", createdAt: 1 },
						] as unknown as Awaited<ReturnType<SpaceEngine["listRuns"]>>,
				}),
		},
	});
}

describe("knowledge.get", () => {
	test("the files, the flows that fill the folder or review its learnings, and no warning", async () => {
		const got = await call(
			appRouter.knowledge.get,
			{ projectId: "p1" },
			{ context: context("owner", 2) },
		);
		expect(got.files.map((f) => f.path)).toEqual(["page-0.md", "page-1.md"]);
		expect(got.tooLarge).toBe(false);
		expect(got.syncs).toEqual([
			{
				flow: "sync",
				kits: ["kit:knowledge/web"],
				source: {
					kit: "kit:knowledge/web",
					inputs: { urls: "https://example.com" },
				},
				schedule: { cron: "0 6 * * *", enabled: true },
				lastRun: { id: "r2", status: "failed", at: 6 },
			},
		]);
		expect(got.proposed).toBe(3);
		expect(got.reviews).toEqual(["review-learnings"]);
		expect(got.shared).toBe(true);
	});

	test("warns past 2 000 files", async () => {
		const got = await call(
			appRouter.knowledge.get,
			{ projectId: "p1" },
			{ context: context("owner", 2001) },
		);
		expect(got.tooLarge).toBe(true);
	});

	test("any Member of the Space reads it, not only the owner of this computer, and only of its projects", async () => {
		const got = await call(
			appRouter.knowledge.get,
			{ projectId: "p1" },
			{ context: context("member", 1) },
		);
		expect(got.files).toHaveLength(1);
		await expect(
			call(
				appRouter.knowledge.get,
				{ projectId: "p9" },
				{ context: context("member", 1) },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});
});

function searchContext(personId: string) {
	const asked: unknown[] = [];
	const ctx = testContext({
		access: accessAs({ personId, spaceId: "s1", role: "viewer" }),
		daemon: { device: { id: "d1", name: "studio", ownerId: "owner" } },
		knowledgeSearch: {
			search: async (projectId, query, options) => {
				asked.push({ projectId, query, options });
				return [
					{
						path: "wiki/deploy.md",
						title: "Deploy",
						snippet: [
							{ text: "How we ", match: false },
							{ text: "deploy", match: true },
						],
						score: 1.5,
					},
				];
			},
			read: async (projectId, path, options) => {
				asked.push({ projectId, path, options });
				return path === "wiki/deploy.md"
					? {
							path,
							title: "Deploy",
							text: "# Deploy",
							size: 8,
							truncated: false,
						}
					: null;
			},
		},
		knowledge: {
			read: async (_projectId, path, options) => {
				asked.push({ byHash: path, options });
				return path === "wiki/elsewhere.md"
					? {
							path,
							title: "Elsewhere",
							text: "# Elsewhere",
							size: 11,
							truncated: false,
						}
					: null;
			},
		},
		engine: {
			space: () =>
				stub<SpaceEngine>("Space view", {
					listProjects: async () =>
						[{ id: "p1" }] as Awaited<ReturnType<SpaceEngine["listProjects"]>>,
				}),
		},
	});
	return { ctx, asked };
}

describe("knowledge.search and knowledge.read", () => {
	test("search passes the words and the limit, and returns the hits", async () => {
		const { ctx, asked } = searchContext("owner");
		const hits = await call(
			appRouter.knowledge.search,
			{ projectId: "p1", query: "deploy", limit: 5 },
			{ context: ctx },
		);
		expect(hits.map((h) => h.path)).toEqual(["wiki/deploy.md"]);
		expect(asked).toEqual([
			{ projectId: "p1", query: "deploy", options: { limit: 5 } },
		]);
	});

	test("read gives one file: this computer's copy, else by its hash in the Space, or null when there is none", async () => {
		const { ctx, asked } = searchContext("member");
		const file = await call(
			appRouter.knowledge.read,
			{ projectId: "p1", path: "wiki/deploy.md" },
			{ context: ctx },
		);
		expect(file?.text).toBe("# Deploy");
		const elsewhere = await call(
			appRouter.knowledge.read,
			{ projectId: "p1", path: "wiki/elsewhere.md" },
			{ context: ctx },
		);
		expect(elsewhere?.text).toBe("# Elsewhere");
		expect(asked).toContainEqual({
			byHash: "wiki/elsewhere.md",
			options: { maxBytes: 1024 * 1024 },
		});
		expect(
			await call(
				appRouter.knowledge.read,
				{ projectId: "p1", path: "nope.md" },
				{ context: ctx },
			),
		).toBeNull();
	});

	test("any Member of the Space searches, and only its projects", async () => {
		const { ctx } = searchContext("member");
		await expect(
			call(
				appRouter.knowledge.search,
				{ projectId: "p9", query: "x" },
				{ context: ctx },
			),
		).rejects.toBeInstanceOf(ORPCError);
		const hits = await call(
			appRouter.knowledge.search,
			{ projectId: "p1", query: "x" },
			{ context: ctx },
		);
		expect(hits).toHaveLength(1);
	});
});

/** A project's flows and schedules in memory, as the source procedures change them. */
function sourceContext(
	personId: string,
	role: "member" | "viewer" = "member",
	flows: Record<string, Flow | null> = {},
) {
	const state = {
		flows: { ...flows },
		schedules: [] as Schedule[],
		removedFolders: [] as string[],
	};
	const ctx = testContext({
		access: accessAs({ personId, spaceId: "s1", role }),
		daemon: { device: { id: "d1", name: "studio", ownerId: "owner" } },
		knowledge: {
			removeFolder: async (_projectId, folder) => {
				state.removedFolders.push(folder);
				return 2;
			},
		},
		engine: {
			space: () =>
				stub<SpaceEngine>("Space view", {
					flows: stub<SpaceFlows>("flows", {
						map: async () => ({ ...state.flows }),
						save: async (_projectId, name, flow) => {
							state.flows[name] = flow;
							return [];
						},
						remove: async (_projectId, name) => {
							delete state.flows[name];
						},
					}),
					listSchedules: async () =>
						({
							path: "",
							issues: [],
							schedules: state.schedules.map((schedule) => ({
								...schedule,
								nextAt: null,
								last: null,
								deliveries: [],
								issues: [],
							})),
						}) as unknown as Awaited<ReturnType<SpaceEngine["listSchedules"]>>,
					saveSchedules: async (_projectId, schedules) => {
						state.schedules = [...schedules];
						return [];
					},
				}),
		},
	});
	return { ctx, state };
}

describe("knowledge.saveSource and knowledge.removeSource", () => {
	test("adds a source as a flow that calls the kit, with its own folder and a schedule", async () => {
		const { ctx, state } = sourceContext("owner", "member", { sync: syncFlow });
		const saved = await call(
			appRouter.knowledge.saveSource,
			{
				projectId: "p1",
				source: {
					kit: "kit:knowledge/web",
					inputs: { urls: " https://example.org ", folder: "" },
				},
				keepUpToDate: { cron: "0 6 * * *" },
				timeZone: "Europe/Amsterdam",
			},
			{ context: ctx },
		);
		expect(saved).toEqual({ name: "knowledge-web-pages", issues: [] });
		// The other web sync fills web: this one gets a folder of its own.
		expect(state.flows["knowledge-web-pages"]?.nodes[0]).toMatchObject({
			type: "call",
			flow: "kit:knowledge/web",
			inputs: { urls: "https://example.org", folder: "web-2" },
		});
		expect(state.schedules).toEqual([
			{
				id: "knowledge-web-pages",
				flow: "knowledge-web-pages",
				inputs: {},
				cron: "0 6 * * *",
				enabled: true,
			},
		]);
	});

	test("a folder of this computer syncs on this computer", async () => {
		const { ctx, state } = sourceContext("owner");
		await call(
			appRouter.knowledge.saveSource,
			{
				projectId: "p1",
				source: { kit: "kit:knowledge/folder", inputs: { path: "~/notes" } },
				keepUpToDate: { cron: "0 6 * * *" },
			},
			{ context: ctx },
		);
		expect(state.schedules[0]?.device).toBe("studio");
		expect(state.flows["knowledge-folder"]?.nodes[0]).toMatchObject({
			inputs: { path: "~/notes", folder: "folder" },
		});
	});

	test("edits a source in place, and refuses a flow the page did not make", async () => {
		const { ctx, state } = sourceContext("member", "member", {
			drawn: flowSchema.parse({
				...syncFlow,
				nodes: [
					...syncFlow.nodes,
					{ id: "end", type: "end", position: { x: 1, y: 1 }, status: "done" },
				],
			}),
		});
		const first = await call(
			appRouter.knowledge.saveSource,
			{
				projectId: "p1",
				source: { kit: "kit:knowledge/github-wiki", inputs: { repo: "a/b" } },
			},
			{ context: ctx },
		);
		await call(
			appRouter.knowledge.saveSource,
			{
				projectId: "p1",
				name: first.name,
				source: { kit: "kit:knowledge/github-wiki", inputs: { repo: "c/d" } },
			},
			{ context: ctx },
		);
		expect(Object.keys(state.flows).sort()).toEqual([
			"drawn",
			"knowledge-github-wiki",
		]);
		expect(state.flows["knowledge-github-wiki"]?.nodes[0]).toMatchObject({
			inputs: { repo: "c/d", folder: "wiki" },
		});
		await expect(
			call(
				appRouter.knowledge.saveSource,
				{
					projectId: "p1",
					name: "drawn",
					source: { kit: "kit:knowledge/web", inputs: { urls: "x" } },
				},
				{ context: ctx },
			),
		).rejects.toThrow("no such source");
	});

	test("refuses missing values, a schedule from someone who does not own this computer, and a viewer", async () => {
		const member = sourceContext("member").ctx;
		await expect(
			call(
				appRouter.knowledge.saveSource,
				{ projectId: "p1", source: { kit: "kit:knowledge/web", inputs: {} } },
				{ context: member },
			),
		).rejects.toThrow("Fill in Pages.");
		await expect(
			call(
				appRouter.knowledge.saveSource,
				{
					projectId: "p1",
					source: { kit: "kit:knowledge/web", inputs: { urls: "x" } },
					keepUpToDate: { cron: "0 6 * * *" },
				},
				{ context: member },
			),
		).rejects.toThrow("Only the owner of this computer");
		await expect(
			call(
				appRouter.knowledge.saveSource,
				{
					projectId: "p1",
					source: { kit: "kit:knowledge/web", inputs: { urls: "x" } },
				},
				{ context: sourceContext("viewer", "viewer").ctx },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	test("removes a source, its schedule and its files, but not a folder another flow fills", async () => {
		const { ctx, state } = sourceContext("owner");
		const one = await call(
			appRouter.knowledge.saveSource,
			{
				projectId: "p1",
				source: { kit: "kit:knowledge/web", inputs: { urls: "a" } },
				keepUpToDate: { cron: "0 6 * * *" },
			},
			{ context: ctx },
		);
		const removed = await call(
			appRouter.knowledge.removeSource,
			{ projectId: "p1", name: one.name, removeFiles: true },
			{ context: ctx },
		);
		expect(removed).toEqual({ removedFiles: 2 });
		expect(state.flows).toEqual({});
		expect(state.schedules).toEqual([]);
		expect(state.removedFolders).toEqual(["web"]);

		const two = await call(
			appRouter.knowledge.saveSource,
			{
				projectId: "p1",
				source: { kit: "kit:knowledge/web", inputs: { urls: "a" } },
			},
			{ context: ctx },
		);
		state.flows.other = syncFlow;
		state.flows[two.name] = callFlow("kit:knowledge/web", {
			urls: "a",
			folder: "web",
		});
		expect(
			await call(
				appRouter.knowledge.removeSource,
				{ projectId: "p1", name: two.name, removeFiles: true },
				{ context: ctx },
			),
		).toEqual({ removedFiles: 0 });
		expect(state.removedFolders).toEqual(["web"]);
	});
});
