import { afterEach, describe, expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import { createRunLog, type KnowledgeUseFact } from "../log";
import { createSandbox, type Sandbox } from "../testing";
import {
	askedQuestions,
	knowledgeFileUse,
	logKnowledgeUse,
	stepSources,
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
	return { db: sandbox.db, log };
}

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
			read(3, "e.pdf", { from: { page: 4, line: 2 } }),
			read(4, "gone.md", { found: false }),
			read(5, "b.md"),
		]);
		expect(sources).toEqual([
			{ path: "b.md", section: "S1", page: null, line: 1, read: true },
			{ path: "e.pdf", section: null, page: 4, line: 2, read: true },
			{ path: "a.md", section: "S0", page: null, line: 1, read: false },
			{ path: "c.md", section: "S2", page: null, line: 1, read: false },
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
		const now = Date.now() + 1000;
		const report = await knowledgeFileUse(db, "p1", now);
		expect(report.unusedDays).toBe(30);
		// Only the MCP server used it: no run did.
		expect(report.runsUsedIt).toBe(false);
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
			(await knowledgeFileUse(db, "p1", now + 91 * 86_400_000)).files,
		).toEqual([]);
	});
});
