import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Role } from "@nightshift/auth";
import { event } from "@nightshift/db/schema";
import { createEngine, type Engine } from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	testKnowledge,
	withDevice,
} from "@nightshift/engine/testing";
import { call, ORPCError } from "@orpc/server";

import { appRouter } from "../router";
import { accessAs, testContext } from "../testing/context";

/**
 * The Knowledge page's procedures over a real Space on this computer: the
 * files and the sources, for any Member of the Space (ADR 4), with their
 * checks of who asks, and search and one file. What a source does to the
 * flows and schedules is the engine's (`knowledgeSources`).
 */

let sandbox: Sandbox;
let engine: Engine;
let built: ReturnType<typeof testKnowledge>;
let projectId: string;

beforeEach(async () => {
	sandbox = await createSandbox();
	built = testKnowledge(sandbox, { pageWaitMs: 5_000 });
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			harnesses: {},
			knowledge: built.knowledge,
		}),
	);
	({ id: projectId } = await engine
		.space(sandbox.spaceId)
		.addProject({ repoPath: sandbox.repoPath }));
});
afterEach(async () => {
	built.close();
	await engine.dispose();
	await sandbox.cleanup();
});

/** A request of `personId` in the sandbox's Space; "owner" owns this computer. */
function context(personId: string, role: Role = "member") {
	return testContext({
		access: accessAs({ personId, spaceId: sandbox.spaceId, role }),
		daemon: {
			device: { id: sandbox.deviceId, name: "test", ownerId: "owner" },
		},
		db: sandbox.db,
		engine,
		knowledge: built.knowledge,
		knowledgeSearch: {
			search: async (_projectId, query) =>
				query === "deploy"
					? [
							{
								path: "wiki/deploy.md",
								title: "Deploy",
								section: "Rolling updates",
								line: 12,
								page: null,
								snippet: [{ text: "deploy", match: true }],
								score: 0.0328,
								found: ["words", "meaning"],
							},
						]
					: [],
			meaning: async () => ({
				state: "preparing",
				model: "qwen3-embedding:0.6b",
				done: 3,
				total: 10,
			}),
		},
	});
}

async function putFile(path: string, text: string) {
	const abs = join(built.folder(projectId), path);
	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, text);
}

const webSource = {
	kit: "kit:knowledge/web" as const,
	inputs: { urls: "https://example.org" },
};

describe("knowledge.get", () => {
	test("says what the person may do: by role, and schedules for this computer's owner", async () => {
		const asMember = await call(
			appRouter.knowledge.get,
			{ projectId },
			{ context: context("member", "member") },
		);
		expect(asMember.can).toEqual({
			save: true,
			remove: true,
			startRuns: true,
			schedules: false,
		});
		const asOwner = await call(
			appRouter.knowledge.get,
			{ projectId },
			{ context: context("owner", "owner") },
		);
		expect(asOwner.can.schedules).toBe(true);
	});

	test("any Member of the Space reads the files and the sources, and only of its projects", async () => {
		await call(
			appRouter.knowledge.saveSource,
			{ projectId, source: webSource, keepUpToDate: { cron: "0 6 * * *" } },
			{ context: context("owner") },
		);
		await putFile("web/a.md", "# A\n");
		const got = await call(
			appRouter.knowledge.get,
			{ projectId },
			{ context: context("viewer", "viewer") },
		);
		expect(got.files.map((f) => f.path)).toEqual(["web/a.md"]);
		expect(got.syncs).toEqual([
			{
				flow: "knowledge-web-pages",
				kits: ["kit:knowledge/web"],
				source: {
					kit: "kit:knowledge/web",
					inputs: { urls: "https://example.org", folder: "web" },
				},
				schedule: { cron: "0 6 * * *", enabled: true },
				lastRun: null,
				health: null,
			},
		]);
		expect(got.can).toEqual({
			save: false,
			remove: false,
			startRuns: false,
			schedules: false,
		});
		await expect(
			call(
				appRouter.knowledge.get,
				{ projectId: "p9" },
				{ context: context("viewer", "viewer") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});
});

describe("knowledge.saveSource, removeSource and syncSource", () => {
	test("a schedule is the owner's of this computer, a source is for a role that saves flows", async () => {
		await expect(
			call(
				appRouter.knowledge.saveSource,
				{ projectId, source: webSource, keepUpToDate: { cron: "0 6 * * *" } },
				{ context: context("member") },
			),
		).rejects.toThrow("Only the owner of this computer");
		await expect(
			call(
				appRouter.knowledge.saveSource,
				{ projectId, source: webSource },
				{ context: context("viewer", "viewer") },
			),
		).rejects.toBeInstanceOf(ORPCError);
		const saved = await call(
			appRouter.knowledge.saveSource,
			{ projectId, source: webSource },
			{ context: context("member") },
		);
		expect(saved).toEqual({ name: "knowledge-web-pages", issues: [] });
		await expect(
			call(
				appRouter.knowledge.saveSource,
				{ projectId, source: { kit: "kit:knowledge/web", inputs: {} } },
				{ context: context("member") },
			),
		).rejects.toThrow("Fill in Pages.");
	});

	test("removing files asks a role that may start runs; removing a schedule asks the owner", async () => {
		const { name } = await call(
			appRouter.knowledge.saveSource,
			{ projectId, source: webSource, keepUpToDate: { cron: "0 6 * * *" } },
			{ context: context("owner") },
		);
		await putFile("web/a.md", "# A\n");
		await call(
			appRouter.knowledge.get,
			{ projectId },
			{ context: context("owner") },
		);
		await expect(
			call(
				appRouter.knowledge.removeSource,
				{ projectId, name, removeFiles: true },
				{ context: context("viewer", "viewer") },
			),
		).rejects.toBeInstanceOf(ORPCError);
		await expect(
			call(
				appRouter.knowledge.removeSource,
				{ projectId, name, removeFiles: true },
				{ context: context("member") },
			),
		).rejects.toThrow("Only the owner of this computer");
		expect(
			await call(
				appRouter.knowledge.removeSource,
				{ projectId, name, removeFiles: true },
				{ context: context("owner") },
			),
		).toEqual({ removedFiles: 1 });
		await expect(
			call(
				appRouter.knowledge.removeSource,
				{ projectId, name, removeFiles: false },
				{ context: context("owner") },
			),
		).rejects.toThrow("no such source");
	});

	test("a viewer may not sync a source", async () => {
		const { name } = await call(
			appRouter.knowledge.saveSource,
			{ projectId, source: webSource },
			{ context: context("owner") },
		);
		await expect(
			call(
				appRouter.knowledge.syncSource,
				{ projectId, name },
				{ context: context("viewer", "viewer") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});
});

describe("knowledge.search and knowledge.read", () => {
	test("search gives the hits of a project of the Space, and refuses another", async () => {
		const hits = await call(
			appRouter.knowledge.search,
			{ projectId, query: "deploy", limit: 5 },
			{ context: context("viewer", "viewer") },
		);
		expect(hits.map((h) => h.path)).toEqual(["wiki/deploy.md"]);
		expect(hits[0]).toMatchObject({
			section: "Rolling updates",
			line: 12,
			found: ["words", "meaning"],
		});
		await expect(
			call(
				appRouter.knowledge.search,
				{ projectId: "p9", query: "x" },
				{ context: context("viewer", "viewer") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	test("meaning says whether search finds by meaning on this computer, and refuses another project", async () => {
		const ctx = context("viewer", "viewer");
		expect(
			await call(appRouter.knowledge.meaning, { projectId }, { context: ctx }),
		).toEqual({
			state: "preparing",
			model: "qwen3-embedding:0.6b",
			done: 3,
			total: 10,
		});
		await expect(
			call(appRouter.knowledge.meaning, { projectId: "p9" }, { context: ctx }),
		).rejects.toBeInstanceOf(ORPCError);
	});

	test("read gives one file of the knowledge, or null, and refuses a project of another Space", async () => {
		await putFile("wiki/deploy.md", "# Deploy\n");
		const ctx = context("viewer", "viewer");
		const file = await call(
			appRouter.knowledge.read,
			{ projectId, path: "wiki/deploy.md" },
			{ context: ctx },
		);
		expect(file).toMatchObject({ title: "Deploy", text: "# Deploy\n" });
		expect(
			await call(
				appRouter.knowledge.read,
				{ projectId, path: "nope.md" },
				{ context: ctx },
			),
		).toBeNull();
		await expect(
			call(
				appRouter.knowledge.read,
				{ projectId: "p9", path: "wiki/deploy.md" },
				{ context: ctx },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	test("an agent's search and read through the MCP server are logged for the project, the page's are not", async () => {
		await putFile("wiki/deploy.md", "# Deploy\n");
		const ctx = context("viewer", "viewer");
		await call(
			appRouter.knowledge.search,
			{ projectId, query: "deploy" },
			{ context: ctx },
		);
		await call(
			appRouter.knowledge.search,
			{ projectId, query: "deploy", agent: true },
			{ context: ctx },
		);
		await call(
			appRouter.knowledge.read,
			{ projectId, path: "nope.md", agent: true },
			{ context: ctx },
		);
		const rows = (await sandbox.db.select().from(event))
			.filter((row) => row.type.startsWith("Knowledge"))
			.sort((a, b) => a.seq - b.seq);
		expect(rows.map((row) => [row.type, row.runId])).toEqual([
			["KnowledgeSearched", null],
			["KnowledgeRead", null],
		]);
		expect(rows.map((row) => JSON.parse(row.payload))).toEqual([
			{
				projectId,
				query: "deploy",
				hits: [
					{
						path: "wiki/deploy.md",
						section: "Rolling updates",
						line: 12,
						page: null,
						found: ["words", "meaning"],
					},
				],
				via: "mcp",
			},
			{ projectId, path: "nope.md", found: false, via: "mcp" },
		]);
	});
});

describe("knowledge.questions and knowledge.markQuestion", () => {
	test("lists what agents asked with its answers once marked; marking asks a role that may start runs", async () => {
		await putFile("wiki/deploy.md", "# Deploy\n");
		await call(
			appRouter.knowledge.search,
			{ projectId, query: "deploy", agent: true },
			{ context: context("viewer", "viewer") },
		);
		const asked = await call(
			appRouter.knowledge.questions,
			{ projectId },
			{ context: context("viewer", "viewer") },
		);
		expect(asked.set).toEqual([]);
		expect(asked.asked).toMatchObject([
			{ query: "deploy", times: 1, runId: null, answers: null },
		]);
		await expect(
			call(
				appRouter.knowledge.markQuestion,
				{ projectId, query: "deploy", answers: ["wiki/deploy.md"] },
				{ context: context("viewer", "viewer") },
			),
		).rejects.toBeInstanceOf(ORPCError);
		const set = await call(
			appRouter.knowledge.markQuestion,
			{ projectId, query: "deploy", answers: ["wiki/deploy.md"] },
			{ context: context("member") },
		);
		expect(set).toMatchObject([
			{ query: "deploy", answers: ["wiki/deploy.md"], by: "member" },
		]);
		const after = await call(
			appRouter.knowledge.questions,
			{ projectId },
			{ context: context("viewer", "viewer") },
		);
		expect(after.asked[0]?.answers).toEqual(["wiki/deploy.md"]);
		expect(after.set).toHaveLength(1);
	});
});

describe("knowledge.evaluate and knowledge.setMeaning", () => {
	test("the question set runs by words while search by meaning is not ready; turning it off asks a role that may start runs", async () => {
		await putFile("wiki/deploy.md", "# Deploy\n");
		await built.knowledge.markQuestion(projectId, {
			query: "deploy",
			answers: ["wiki/deploy.md"],
			by: "member",
		});
		const result = await call(
			appRouter.knowledge.evaluate,
			{ projectId },
			{ context: context("viewer", "viewer") },
		);
		expect(result).toMatchObject({
			questions: 1,
			advice: "unavailable",
			modes: { words: { found: 1, recall: 1 }, meaning: null, both: null },
		});
		await expect(
			call(
				appRouter.knowledge.setMeaning,
				{ projectId, on: false },
				{ context: context("viewer", "viewer") },
			),
		).rejects.toBeInstanceOf(ORPCError);
		await call(
			appRouter.knowledge.setMeaning,
			{ projectId, on: false },
			{ context: context("member") },
		);
		expect(await built.knowledge.meaningOn(projectId)).toBe(false);
	});
});
