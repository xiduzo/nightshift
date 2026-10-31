import { afterEach, describe, expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import { createRunLog } from "../log";
import { createSandbox, type Sandbox } from "../testing";
import { askedQuestions, logKnowledgeUse } from "./use";

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
