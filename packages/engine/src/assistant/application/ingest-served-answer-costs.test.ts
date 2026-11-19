import { describe, expect, test } from "bun:test";
import { inMemoryAssistantPorts } from "../adapters/out/in-memory-neighbours";
import type { ServedAnswerCost } from "../domain/answer-costs";
import { ingestServedAnswerCosts } from "./ingest-served-answer-costs";
import { keepAnswerCost } from "./keep-answer-cost";

/** The use case ingestServedAnswerCosts, on in-memory adapters. */

const served = (key: string, seq: number): ServedAnswerCost => ({
	key,
	spaceId: "space-a",
	projectId: null,
	agent: "builder",
	entry: null,
	inputTokens: 1,
	outputTokens: 1,
	costUsd: 0.5,
	at: 1_000,
	seq,
	deviceId: "laptop",
	personId: "ada-there",
});

describe("ingestServedAnswerCosts", () => {
	test("keeps a new answer as its Device's, and an own one takes the Host's number and stays", async () => {
		const ports = inMemoryAssistantPorts();
		await keepAnswerCost(ports)({
			at: 1_000,
			agent: "builder",
			entry: null,
			projectId: null,
			spaceId: "space-a",
			personId: "ada-here",
			inputTokens: 1,
			outputTokens: 1,
			costUsd: 0.1,
		});
		await ingestServedAnswerCosts(ports)({
			rows: [served("key-1", 4), served("theirs", 5)],
			now: 9_000,
		});
		expect(
			ports.records.rows.map((row) => [
				row.key,
				row.deviceId,
				row.personId,
				row.costUsd,
				row.hostSeq,
				row.sentAt,
			]),
		).toEqual([
			["key-1", null, "ada-here", 0.1, 4, 9_000],
			["theirs", "laptop", "ada-there", 0.5, 5, 9_000],
		]);
	});
});
