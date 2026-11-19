import { describe, expect, test } from "bun:test";
import { inMemoryAssistantPorts } from "../adapters/out/in-memory-neighbours";
import type { AnswerCost } from "../domain/answer-costs";
import { keepAnswerCost } from "./keep-answer-cost";

/** The use case keepAnswerCost, on in-memory adapters. */

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
	test("keeps each answer under a new key, as this computer's own", async () => {
		const ports = inMemoryAssistantPorts();
		await keepAnswerCost(ports)(cost);
		await keepAnswerCost(ports)(cost);
		expect(
			ports.records.rows.map((row) => [row.key, row.deviceId, row.sentAt]),
		).toEqual([
			["key-1", null, null],
			["key-2", null, null],
		]);
		expect(await ports.answerCostStore.list("space-a")).toEqual([
			{ ...cost, key: "key-1" },
			{ ...cost, key: "key-2" },
		]);
	});
});
