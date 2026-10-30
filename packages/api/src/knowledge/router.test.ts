import { describe, expect, test } from "bun:test";
import type { SpaceEngine, SpaceFlows } from "@nightshift/engine";
import { type Flow, flowSchema } from "@nightshift/flows";
import { call, ORPCError } from "@orpc/server";

import { appRouter } from "../router";
import { accessAs, stub, testContext } from "../testing/context";

/**
 * The Knowledge page's procedure: the folder's files on this computer, the
 * size warning and the flows that fill it, for the owner of this computer.
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
		access: accessAs({ personId, spaceId: "s1", role: "owner" }),
		daemon: { device: { id: "d1", name: "studio", ownerId: "owner" } },
		knowledge: {
			proposed: async () => 3,
			index: async () =>
				Array.from({ length: files }, (_, i) => ({
					path: `page-${i}.md`,
					size: 10,
					changedAt: 1,
				})),
		},
		engine: {
			space: () =>
				stub<SpaceEngine>("Space view", {
					flows: stub<SpaceFlows>("flows", {
						map: async () => ({
							sync: syncFlow,
							"review-learnings": reviewFlow,
							broken: null,
						}),
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
	});

	test("warns past 2 000 files", async () => {
		const got = await call(
			appRouter.knowledge.get,
			{ projectId: "p1" },
			{ context: context("owner", 2001) },
		);
		expect(got.tooLarge).toBe(true);
	});

	test("only the owner of this computer reads its disk", async () => {
		await expect(
			call(
				appRouter.knowledge.get,
				{ projectId: "p1" },
				{ context: context("member", 1) },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});
});

function searchContext(personId: string) {
	const asked: unknown[] = [];
	const ctx = testContext({
		access: accessAs({ personId, spaceId: "s1", role: "owner" }),
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

	test("read gives one file, or null when there is none", async () => {
		const { ctx } = searchContext("owner");
		const file = await call(
			appRouter.knowledge.read,
			{ projectId: "p1", path: "wiki/deploy.md" },
			{ context: ctx },
		);
		expect(file?.text).toBe("# Deploy");
		expect(
			await call(
				appRouter.knowledge.read,
				{ projectId: "p1", path: "nope.md" },
				{ context: ctx },
			),
		).toBeNull();
	});

	test("refuses a project the Space does not have, and anyone but the owner", async () => {
		const { ctx } = searchContext("owner");
		await expect(
			call(
				appRouter.knowledge.search,
				{ projectId: "p9", query: "x" },
				{ context: ctx },
			),
		).rejects.toBeInstanceOf(ORPCError);
		await expect(
			call(
				appRouter.knowledge.search,
				{ projectId: "p1", query: "x" },
				{ context: searchContext("member").ctx },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});
});
