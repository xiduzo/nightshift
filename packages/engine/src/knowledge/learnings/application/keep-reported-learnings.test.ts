import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@nightshift/agents/types";
import { keepReportedLearnings } from "./keep-reported-learnings";
import type { ProposeLearnings } from "./propose-learnings";

/** The use case keepReportedLearnings, on in-memory adapters. Twin of "keepReported" in `learnings.test.ts`. */

async function* eventsOf(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
	yield* events;
}

async function seenOf(events: AsyncGenerator<AgentEvent>) {
	const seen: AgentEvent[] = [];
	for await (const event of events) seen.push(event);
	return seen;
}

describe("keepReportedLearnings", () => {
	test("keeps the events as they are, and the learnings of each report", async () => {
		const proposed: ProposeLearnings[] = [];
		const keep = keepReportedLearnings({
			propose: async (request) => {
				proposed.push(request);
			},
		});
		const events = [
			{ type: "text", text: "Working." },
			{ type: "report", outcome: "pass", learnings: ["Run make first."] },
			{ type: "report", outcome: "pass" },
		] as AgentEvent[];
		const step = { runId: "run-1", stepId: "s1" };
		expect(
			await seenOf(keep({ events: eventsOf(events), projectId: "p1", step })),
		).toEqual(events);
		expect(proposed).toEqual([
			{ projectId: "p1", step, notes: ["Run make first."] },
		]);
	});

	test("a note that cannot be kept is left out: the step goes on", async () => {
		const keep = keepReportedLearnings({
			propose: async () => {
				throw new Error("The disk is full.");
			},
		});
		const events = [
			{ type: "report", outcome: "pass", learnings: ["One."] },
		] as AgentEvent[];
		expect(
			await seenOf(
				keep({
					events: eventsOf(events),
					projectId: "p1",
					step: { runId: "run-1" },
				}),
			),
		).toEqual(events);
	});
});
