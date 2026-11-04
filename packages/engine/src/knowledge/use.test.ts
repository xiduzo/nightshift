import { afterEach, describe, expect, test } from "bun:test";
import type { KnowledgeUse } from "@nightshift/agents/tools";
import { project, run } from "@nightshift/db/schema";
import { now as timeNow } from "@nightshift/time";
import { createRunLog, type KnowledgeUseFact, type RunLog } from "../log";
import { createSandbox, type Sandbox } from "../testing";
import {
	askedQuestions,
	knowledgeFileUse,
	knowledgeUseEvent,
	stepSources,
	unusedFiles,
} from "./use";

/** How agents used a project's knowledge, read back from the event log. */

const sandboxes: Sandbox[] = [];
afterEach(async () => {
	await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
});

async function setup() {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	for (const id of ["p1", "p2"]) {
		await sandbox.db
			.insert(project)
			.values({ id, spaceId: sandbox.spaceId, name: id });
	}
	const log = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	return { db: sandbox.db, log, sandbox };
}

/** A use through the nightshift MCP server: a fact of the project, with no run. */
const logKnowledgeUse = (log: RunLog, projectId: string, use: KnowledgeUse) =>
	log.append(knowledgeUseEvent(projectId, use, "mcp"));

const hit = (path: string) => ({
	path,
	section: null,
	line: 1,
	page: null,
	found: ["words" as const],
});

describe("askedQuestions", () => {
	test("each question once, newest first, with what its last asking found and how often it was asked", async () => {
		const { db, log } = await setup();
		const search = (projectId: string, query: string, paths: string[]) =>
			logKnowledgeUse(log, projectId, {
				kind: "search",
				query,
				hits: paths.map(hit),
			});
		await search("p1", "deploy at night", ["a.md"]);
		await search("p1", "rollback", []);
		await search("p2", "deploy at night", ["other.md"]);
		await logKnowledgeUse(log, "p1", {
			kind: "read",
			path: "a.md",
			found: true,
		});
		await search("p1", "Deploy  at night", ["b.md", "a.md"]);

		const asked = await askedQuestions(db, "p1");
		expect(
			asked.map((q) => [q.query, q.times, q.hits.map((h) => h.path)]),
		).toEqual([
			["Deploy  at night", 2, ["b.md", "a.md"]],
			["rollback", 1, []],
		]);
		expect(asked[0]).toMatchObject({ runId: null, stepId: null });
		expect(await askedQuestions(db, "p1", { limit: 1 })).toHaveLength(1);
	});
});

describe("stepSources", () => {
	const searched = (seq: number, paths: string[]): KnowledgeUseFact => ({
		type: "KnowledgeSearched",
		seq,
		at: seq,
		stepId: "s1",
		payload: {
			projectId: "p1",
			query: "q",
			hits: paths.map((path, i) => ({ ...hit(path), section: `S${i}` })),
			via: "step",
		},
	});
	const read = (
		seq: number,
		path: string,
		extra: {
			found?: boolean;
			from?: { section?: string; page?: number; line?: number };
		} = {},
	): KnowledgeUseFact => ({
		type: "KnowledgeRead",
		seq,
		at: seq,
		stepId: "s1",
		payload: {
			projectId: "p1",
			path,
			found: extra.found ?? true,
			via: "step",
			...(extra.from ? { from: extra.from } : {}),
		},
	});

	test("the files read first, at the spot read or found, then the top 3 hits not read", () => {
		const sources = stepSources([
			searched(1, ["a.md", "b.md", "c.md", "d.md"]),
			read(2, "b.md"),
			read(2, "c.md", { from: { section: "S2" } }),
			read(3, "e.pdf", { from: { page: 4, line: 2 } }),
			read(4, "gone.md", { found: false }),
			read(5, "b.md"),
		]);
		expect(sources).toEqual([
			{ path: "b.md", section: "S1", page: null, line: 1, read: true },
			{ path: "c.md", section: "S2", page: null, line: 1, read: true },
			{ path: "e.pdf", section: null, page: 4, line: 2, read: true },
			{ path: "a.md", section: "S0", page: null, line: 1, read: false },
		]);
		expect(stepSources([])).toEqual([]);
	});
});

describe("knowledgeFileUse", () => {
	test("counts each file found in a top 5 and read, and when a run last used it", async () => {
		const { db, log } = await setup();
		await logKnowledgeUse(log, "p1", {
			kind: "search",
			query: "deploy",
			hits: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"].map(hit),
		});
		await logKnowledgeUse(log, "p1", {
			kind: "read",
			path: "a.md",
			found: true,
		});
		await logKnowledgeUse(log, "p1", {
			kind: "read",
			path: "x.md",
			found: false,
		});
		const now = timeNow() + 1000;
		const report = await knowledgeFileUse(db, "p1", [], now);
		expect(report.unusedDays).toBe(30);
		// Only the MCP server used it: no run did.
		expect(report.runsUsedIt).toBe(false);
		expect(report.unused).toEqual([]);
		expect(
			report.files.map((f) => [f.path, f.found, f.read, f.lastRunAt]),
		).toEqual([
			["a.md", 1, 1, null],
			["b.md", 1, 0, null],
			["c.md", 1, 0, null],
			["d.md", 1, 0, null],
			["e.md", 1, 0, null],
		]);
		// Past the window, nothing counts.
		expect(
			(await knowledgeFileUse(db, "p1", [], now + 91 * 86_400_000)).files,
		).toEqual([]);
	});

	test("a run's use lately: the old files no run used are not used, a file no agent touched too", async () => {
		const { db, log, sandbox } = await setup();
		await db.insert(run).values({
			id: "r1",
			spaceId: sandbox.spaceId,
			projectId: "p1",
			flowName: null,
			flow: "{}",
			bodyFlows: "{}",
			title: "test",
			worktreePath: sandbox.repoPath,
			branch: "nightshift/test",
			baseRef: "main",
			walkerId: sandbox.deviceId,
		});
		await log.append({
			...knowledgeUseEvent(
				"p1",
				{ kind: "search", query: "deploy", hits: [hit("used.md")] },
				"step",
			),
			runId: "r1",
		});
		const report = await knowledgeFileUse(db, "p1", [
			{ path: "used.md", changedAt: 1 },
			{ path: "never.md", changedAt: 1 },
			{ path: "new.md", changedAt: timeNow() },
		]);
		expect(report.runsUsedIt).toBe(true);
		expect(report.unused).toEqual(["never.md"]);
		// The report lists only what agents used: `unused` is what tells of the rest.
		expect(report.files.map((f) => f.path)).toEqual(["used.md"]);
	});
});

describe("unusedFiles", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const NOW = 100 * DAY;
	const report = (lastRunAt: number | null, runsUsedIt = true) => ({
		unusedDays: 30,
		runsUsedIt,
		files: [{ path: "a.md", found: 1, read: 1, lastAt: 1, lastRunAt }],
	});

	test("an old file no run used lately is not used", () => {
		expect(
			unusedFiles(
				report(10 * DAY),
				[
					{ path: "a.md", changedAt: 1 },
					{ path: "b.md", changedAt: 1 },
				],
				NOW,
			),
		).toEqual(["a.md", "b.md"]);
	});

	test("a file a run used lately is used", () => {
		expect(
			unusedFiles(report(90 * DAY), [{ path: "a.md", changedAt: 1 }], NOW),
		).toEqual([]);
	});

	test("a file that came in lately says nothing yet", () => {
		expect(
			unusedFiles(report(null), [{ path: "a.md", changedAt: 99 * DAY }], NOW),
		).toEqual([]);
	});

	test("no run used the knowledge at all: mark nothing", () => {
		expect(
			unusedFiles(report(null, false), [{ path: "a.md", changedAt: 1 }], NOW),
		).toEqual([]);
	});
});
