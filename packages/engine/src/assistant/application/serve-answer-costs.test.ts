import { describe, expect, test } from "bun:test";
import { inMemoryAssistantPorts } from "../adapters/out/in-memory-neighbours";
import type { SentAnswerCost } from "../domain/answer-costs";
import { serveAnswerCosts } from "./serve-answer-costs";
import { takeSentAnswerCosts } from "./take-sent-answer-costs";

/** The use case serveAnswerCosts, on in-memory adapters. */

const sent = (key: string, spaceId = "space-a"): SentAnswerCost => ({
	key,
	spaceId,
	projectId: "p1",
	agent: "builder",
	entry: "flow.build",
	inputTokens: 1,
	outputTokens: 1,
	costUsd: 0.1,
	at: 1_000,
});

describe("serveAnswerCosts", () => {
	test("a Host serves a Space from its own cursor, and no Space the reader did not name", async () => {
		const ports = inMemoryAssistantPorts();
		await takeSentAnswerCosts(ports)({
			rows: [sent("a1"), sent("b1", "space-b"), sent("a2")],
			from: { deviceId: "laptop", personId: "ada" },
		});
		const serve = serveAnswerCosts(ports);
		const after = (cursors: Record<string, number>, spaces = ["space-a"]) =>
			serve({ spaces, cursors, selfId: "the-host", limit: 10 }).then((rows) =>
				rows.map((row) => row.key),
			);

		expect(await after({})).toEqual(["a1", "a2"]);
		expect(await after({ "space-a": 1 })).toEqual(["a2"]);
		expect(await after({ "space-a": 1 }, ["space-a", "space-b"])).toEqual([
			"b1",
			"a2",
		]);
		expect(await after({}, [])).toEqual([]);
	});
});
