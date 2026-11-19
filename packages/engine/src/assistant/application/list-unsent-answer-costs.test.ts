import { describe, expect, test } from "bun:test";
import { inMemoryAssistantPorts } from "../adapters/out/in-memory-neighbours";
import { keepAnswerCost } from "./keep-answer-cost";
import { listUnsentAnswerCosts } from "./list-unsent-answer-costs";

/** The use case listUnsentAnswerCosts, on in-memory adapters. */

describe("listUnsentAnswerCosts", () => {
	test("this computer's own answers in the Spaces, at most the limit", async () => {
		const ports = inMemoryAssistantPorts();
		for (const spaceId of ["space-a", "space-a", "space-b"]) {
			await keepAnswerCost(ports)({
				at: 1_000,
				agent: "builder",
				entry: null,
				projectId: null,
				spaceId,
				personId: "ada",
				inputTokens: 1,
				outputTokens: 1,
				costUsd: null,
			});
		}
		const unsent = listUnsentAnswerCosts(ports);
		expect(
			(await unsent({ spaces: ["space-a"], limit: 10 })).map((r) => r.key),
		).toEqual(["key-1", "key-2"]);
		expect(await unsent({ spaces: ["space-a"], limit: 1 })).toHaveLength(1);
		expect(await unsent({ spaces: [], limit: 10 })).toEqual([]);
	});
});
