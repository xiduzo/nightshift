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
