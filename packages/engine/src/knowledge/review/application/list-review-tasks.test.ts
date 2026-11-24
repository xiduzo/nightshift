import { describe, expect, spyOn, test } from "bun:test";
import { FLOW_VERSION, flowSchema } from "@nightshift/flows";
import { reviewPorts } from "../test-support";
import { listAskedQuestions } from "./list-asked-questions";
import { listReviewTasks } from "./list-review-tasks";
import { readKnowledgeUse } from "./read-knowledge-use";

/** The use case listReviewTasks, over a database in memory. */

const DAY = 24 * 60 * 60 * 1000;
const webFlow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "sync",
	nodes: [
		{
			id: "sync",
			type: "call",
			position: { x: 0, y: 0 },
			flow: "kit:knowledge/web",
			inputs: { urls: "https://a.b" },
		},
	],
	edges: [],
});

describe("listReviewTasks", () => {
	test("sources that need a look, learnings, questions that found nothing and files no run used, in order", async () => {
		const ports = await reviewPorts();
		ports.setNow(100 * DAY);
		const flowsOf = spyOn(ports.space.flows, "map");
		ports.space.flows.saved.set("wiki", webFlow);
		ports.space.flows.saved.set("ok", webFlow);
		ports.space.runs = [
			{
				id: "r1",
				status: "failed",
				flowName: "wiki",
				createdAt: 1,
				endedAt: 2,
			},
		];
		await ports.sync.publish("p1", "learnings/proposed/one.md", "- A note.\n");
		await ports.logUse("p1", {
			type: "KnowledgeSearched",
			at: 100 * DAY - 1,
			runId: "r",
			stepId: "s",
			payload: { query: "gold", hits: [] },
		});
		await ports.sync.publish("p1", "a.md", "A");
		const tasks = await listReviewTasks({
			sources: ports.sources,
			learnings: ports.learnings,
			asked: listAskedQuestions(ports),
			use: readKnowledgeUse(ports),
		})({ projectId: "p1", space: ports.space });
		expect(flowsOf.mock.calls).toEqual([["p1"]]);
		expect(tasks.map(({ id, node }) => [id, node])).toEqual([
			["source:wiki", null],
			["learning:one.md", "learning:one.md"],
			["question:gold", "question:gold"],
			["unused:1", null],
		]);
	});

	test("nothing waits: no tasks", async () => {
		const ports = await reviewPorts();
		const tasks = await listReviewTasks({
			sources: ports.sources,
			learnings: ports.learnings,
			asked: listAskedQuestions(ports),
			use: readKnowledgeUse(ports),
		})({ projectId: "p1", space: ports.space });
		expect(tasks).toEqual([]);
	});
});
