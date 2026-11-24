import { beforeEach, describe, expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { now } from "@nightshift/time";
import { createRunLog } from "../../../../log";
import { knowledgeUseEvent } from "../../../../log/events/knowledge-use";
import { localSpaceId } from "../../../../testing/test-support";
import { drizzleKnowledgeUseLog } from "./drizzle-knowledge-use-log";

/** A use of a project's knowledge to log: a search, or a read of one file. */
export type LoggedUse =
	| { kind: "search"; query: string; paths: string[] }
	| { kind: "read"; path: string; found: boolean };

const make = async () => {
	const db = await migratedDb();
	const spaceId = await localSpaceId(db);
	for (const id of ["p1", "p2"]) {
		await db.insert(project).values({ id, spaceId, name: id });
	}
	const log = createRunLog(db, { walkerId: "here", dataDir: "/nowhere" });
	return {
		knowledgeUseLog: drizzleKnowledgeUseLog(db),
		/** Logs a use through the MCP server (no run), now. */
		async log(projectId: string, use: LoggedUse) {
			await log.append(
				knowledgeUseEvent(
					projectId,
					use.kind === "search"
						? {
								kind: "search",
								query: use.query,
								hits: use.paths.map((path) => ({
									path,
									section: null,
									line: 1,
									page: null,
									found: ["words"],
								})),
							}
						: { kind: "read", path: use.path, found: use.found },
					"mcp",
				),
			);
		},
	};
};

describe("KnowledgeUseLog over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
	});

	test("a project with no use has no events", async () => {
		expect(
			await under.knowledgeUseLog.events("p1", ["KnowledgeSearched"], {
				limit: 10,
			}),
		).toEqual([]);
	});

	test("the project's events of the types asked, newest first, at most the limit", async () => {
		await under.log("p1", {
			kind: "search",
			query: "first",
			paths: ["a.md"],
		});
		await under.log("p2", { kind: "search", query: "other", paths: [] });
		await under.log("p1", { kind: "read", path: "a.md", found: true });
		await under.log("p1", { kind: "search", query: "second", paths: [] });
		const searches = await under.knowledgeUseLog.events(
			"p1",
			["KnowledgeSearched"],
			{ limit: 10 },
		);
		expect(
			searches.map((row) =>
				row.type === "KnowledgeSearched" ? row.payload.query : row.type,
			),
		).toEqual(["second", "first"]);
		expect(searches[1]).toMatchObject({
			runId: null,
			stepId: null,
			payload: { hits: [{ path: "a.md" }] },
		});
		const all = await under.knowledgeUseLog.events(
			"p1",
			["KnowledgeSearched", "KnowledgeRead"],
			{ limit: 2 },
		);
		expect(all.map((row) => row.type)).toEqual([
			"KnowledgeSearched",
			"KnowledgeRead",
		]);
		expect(all[1]?.payload).toMatchObject({ path: "a.md", found: true });
	});

	test("nothing before `since`", async () => {
		await under.log("p1", { kind: "read", path: "a.md", found: true });
		const later = now() + 60_000;
		expect(
			await under.knowledgeUseLog.events("p1", ["KnowledgeRead"], {
				limit: 10,
				since: later,
			}),
		).toEqual([]);
	});
});
