import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { now } from "@nightshift/time";
import type { KnowledgeUseLog } from "../../application/ports";

/** A use of a project's knowledge to log: a search, or a read of one file. */
export type LoggedUse =
	| { kind: "search"; query: string; paths: string[] }
	| { kind: "read"; path: string; found: boolean };

/** One adapter of `KnowledgeUseLog` to test, and how to log a use where it reads. */
export type KnowledgeUseLogUnderTest = {
	knowledgeUseLog: KnowledgeUseLog;
	/** Logs a use through the MCP server (no run), now. */
	log(projectId: string, use: LoggedUse): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `KnowledgeUseLog` does.
 * `knowledge-use-log.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function knowledgeUseLogContract(
	name: string,
	make: () => Promise<KnowledgeUseLogUnderTest>,
): void {
	describe(`KnowledgeUseLog contract: ${name}`, () => {
		let under: KnowledgeUseLogUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
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
}
