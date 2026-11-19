import { describe, expect, test } from "bun:test";
import { inMemoryAssistantPorts } from "../adapters/out/in-memory-neighbours";
import { keepAnswerCost } from "./keep-answer-cost";
import { markAnswerCostsSent } from "./mark-answer-costs-sent";

/** The use case markAnswerCostsSent, on in-memory adapters. */

describe("markAnswerCostsSent", () => {
	test("the Host has them: they are sent once, at the first time", async () => {
		const ports = inMemoryAssistantPorts();
		for (let i = 0; i < 2; i++) {
			await keepAnswerCost(ports)({
				at: 1_000,
				agent: "builder",
				entry: null,
				projectId: null,
				spaceId: "space-a",
				personId: "ada",
				inputTokens: 1,
				outputTokens: 1,
				costUsd: null,
			});
		}
		const mark = markAnswerCostsSent(ports);
		await mark({ keys: ["key-1"], now: 5_000 });
		await mark({ keys: ["key-1"], now: 9_000 });
		expect(ports.records.rows.map((row) => row.sentAt)).toEqual([5_000, null]);
	});
});
