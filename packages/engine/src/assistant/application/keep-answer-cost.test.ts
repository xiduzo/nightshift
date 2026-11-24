import { describe, expect, test } from "bun:test";
import type { AnswerCost } from "../domain/answer-costs";
import { assistantPorts } from "../test-support";
import { keepAnswerCost } from "./keep-answer-cost";

/** The use case keepAnswerCost, over a database in memory. */

const cost: AnswerCost = {
	at: 1_000,
	agent: "builder",
	entry: "flow.build",
	projectId: "p1",
	spaceId: "space-a",
	personId: "ada",
	inputTokens: 1200,
	outputTokens: 300,
	costUsd: 0.42,
};

describe("keepAnswerCost", () => {
	test("keeps each answer under a new key", async () => {
		const ports = await assistantPorts();
		await keepAnswerCost(ports)(cost);
		await keepAnswerCost(ports)(cost);
		expect(await ports.answerCostStore.list("space-a")).toEqual([
			{ ...cost, key: "key-1" },
			{ ...cost, key: "key-2" },
		]);
	});
});
