import { describe, expect, test } from "bun:test";
import { inMemoryAssistantPorts } from "../adapters/out/in-memory-neighbours";
import type { SentAnswerCost } from "../domain/answer-costs";
import { takeSentAnswerCosts } from "./take-sent-answer-costs";

/** The use case takeSentAnswerCosts, on in-memory adapters. */

const sent = (key: string, costUsd = 0.1): SentAnswerCost => ({
	key,
	spaceId: "space-a",
	projectId: "p1",
	agent: "builder",
	entry: "flow.build",
	inputTokens: 1,
	outputTokens: 1,
	costUsd,
	at: 1_000,
});

describe("takeSentAnswerCosts", () => {
	test("a row that comes again is the same answer", async () => {
		const ports = inMemoryAssistantPorts();
		const take = takeSentAnswerCosts(ports);
		const from = { deviceId: "laptop", personId: "ada" };
		expect(await take({ rows: [sent("a1")], from })).toEqual(["a1"]);
		expect(await take({ rows: [sent("a1", 99)], from })).toEqual(["a1"]);
		expect(
			ports.records.rows.map((row) => [row.key, row.deviceId, row.costUsd]),
		).toEqual([["a1", "laptop", 0.1]]);
	});
});
