import { describe, expect, test } from "bun:test";
import type { WaitingLearning } from "../domain/waiting";
import { listProjectLearnings } from "./list-project-learnings";
import type { ListWaitingLearnings } from "./list-waiting-learnings";

/** The use case listProjectLearnings, with the bound `listWaitingLearnings` in memory. */

const learning = (id: string, proposedAt: number): WaitingLearning => ({
	id,
	runId: "run-1",
	stepId: null,
	notes: ["A note."],
	proposedAt,
});

describe("listProjectLearnings", () => {
	test("the learnings of every project, each with its project, newest first and by id for a tie", async () => {
		const asked: ListWaitingLearnings[] = [];
		const waitingIn = new Map([
			["p1", [learning("b", 2), learning("old", 1)]],
			["p2", [learning("a", 2), learning("new", 3)]],
		]);
		const list = listProjectLearnings({
			waiting: async (request) => {
				asked.push(request);
				return waitingIn.get(request.projectId) ?? [];
			},
		});
		const listed = await list({ projectIds: ["p1", "p2", "p3"] });
		expect(listed.map(({ id, projectId }) => [id, projectId])).toEqual([
			["new", "p2"],
			["a", "p2"],
			["b", "p1"],
			["old", "p1"],
		]);
		// Each project once, with no `onlyHere`: the Host may be asked.
		expect(asked).toEqual([
			{ projectId: "p1" },
			{ projectId: "p2" },
			{ projectId: "p3" },
		]);
	});

	test("no project, no learnings", async () => {
		const list = listProjectLearnings({ waiting: async () => [] });
		expect(await list({ projectIds: [] })).toEqual([]);
	});
});
