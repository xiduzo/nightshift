import { describe, expect, test } from "bun:test";
import type { SpaceEngine, SpaceFlows } from "@nightshift/engine";
import { type Flow, flowSchema } from "@nightshift/flows";
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
		expect(got.syncs).toEqual([{ flow: "sync", kits: ["kit:knowledge/web"] }]);
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
