import { describe, expect, test } from "bun:test";
import type { SourcesSpace } from "../../sources";
import { inMemoryReviewPorts } from "../adapters/out/in-memory-neighbours";
import { listAskedQuestions } from "./list-asked-questions";
import { listReviewTasks } from "./list-review-tasks";
import { readKnowledgeUse } from "./read-knowledge-use";

/** The use case listReviewTasks, on in-memory adapters. */

const DAY = 24 * 60 * 60 * 1000;
const space = {} as SourcesSpace;

describe("listReviewTasks", () => {
	test("sources that need a look, learnings, questions that found nothing and files no run used, in order", async () => {
		const ports = inMemoryReviewPorts();
		ports.setNow(100 * DAY);
		ports.syncs.syncsIn.set("p1", [
			{ flow: "wiki", health: "failed" },
			{ flow: "ok", health: null },
		] as never);
		ports.learnings.waitingIn.set("p1", [
			{
				id: "one.md",
				projectId: "p1",
				notes: ["A note."],
				runId: "r",
				stepId: null,
				proposedAt: 1,
			},
		]);
		ports.log.log("p1", {
			type: "KnowledgeSearched",
			at: 100 * DAY - 1,
			runId: "r",
			stepId: "s",
			payload: { query: "gold", hits: [] },
		});
		ports.files.listed.set("p1", [{ path: "a.md", size: 1, changedAt: 1 }]);
		const tasks = await listReviewTasks({
			syncs: ports.syncs,
			learnings: ports.learnings,
			asked: listAskedQuestions(ports),
			use: readKnowledgeUse(ports),
		})({ projectId: "p1", space });
		expect(tasks.map(({ id, node }) => [id, node])).toEqual([
			["source:wiki", null],
			["learning:one.md", "learning:one.md"],
			["question:gold", "question:gold"],
			["unused:1", null],
		]);
	});

	test("nothing waits: no tasks", async () => {
		const ports = inMemoryReviewPorts();
		const tasks = await listReviewTasks({
			syncs: ports.syncs,
			learnings: ports.learnings,
			asked: listAskedQuestions(ports),
			use: readKnowledgeUse(ports),
		})({ projectId: "p1", space });
		expect(tasks).toEqual([]);
	});
});
