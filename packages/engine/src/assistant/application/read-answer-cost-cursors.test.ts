import { describe, expect, test } from "bun:test";
import { inMemoryAssistantPorts } from "../adapters/out/in-memory-neighbours";
import type { ServedAnswerCost } from "../domain/answer-costs";
import { ingestServedAnswerCosts } from "./ingest-served-answer-costs";
import { readAnswerCostCursors } from "./read-answer-cost-cursors";

/** The use case readAnswerCostCursors, on in-memory adapters. */

const served = (
	key: string,
	seq: number,
	spaceId: string,
): ServedAnswerCost => ({
	key,
	spaceId,
	projectId: null,
	agent: "builder",
	entry: null,
	inputTokens: 1,
	outputTokens: 1,
	costUsd: null,
	at: 1_000,
	seq,
	deviceId: "laptop",
	personId: "ada",
});

describe("readAnswerCostCursors", () => {
	test("the last number from the Host of each Space; a Space read of nothing has none", async () => {
		const ports = inMemoryAssistantPorts();
		await ingestServedAnswerCosts(ports)({
			rows: [served("a", 3, "space-a"), served("b", 8, "space-a")],
			now: 9_000,
		});
		expect(
			await readAnswerCostCursors(ports)({ spaces: ["space-a", "space-b"] }),
		).toEqual({ "space-a": 8 });
	});
});
