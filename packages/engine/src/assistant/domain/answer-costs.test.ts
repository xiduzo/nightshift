import { describe, expect, test } from "bun:test";
import { type KeptAnswerCost, knownAnswerCosts } from "./answer-costs";

const kept = (fields: Partial<KeptAnswerCost> = {}): KeptAnswerCost => ({
	key: "k1",
	at: 1_000,
	agent: "builder",
	entry: "flow.build",
	projectId: "p1",
	spaceId: "space-a",
	personId: "ada",
	inputTokens: 1,
	outputTokens: 1,
	costUsd: 0.1,
	...fields,
});

describe("the answers this version can show", () => {
	test("leaves out an agent it does not know, and reads an entry it does not know as none, in order", () => {
		expect(
			knownAnswerCosts([
				kept({ agent: "decider" }),
				kept({ agent: "improver", entry: "somewhere.new", at: 2_000 }),
				kept({ agent: "learner", entry: null, at: 3_000 }),
			]),
		).toEqual([
			{
				at: 2_000,
				agent: "improver",
				entry: null,
				projectId: "p1",
				spaceId: "space-a",
				personId: "ada",
				inputTokens: 1,
				outputTokens: 1,
				costUsd: 0.1,
			},
			{
				at: 3_000,
				agent: "learner",
				entry: null,
				projectId: "p1",
				spaceId: "space-a",
				personId: "ada",
				inputTokens: 1,
				outputTokens: 1,
				costUsd: 0.1,
			},
		]);
	});

	test("an entry it knows stays, and the key does not show", () => {
		const [shown] = knownAnswerCosts([kept()]);
		expect(shown?.entry).toBe("flow.build");
		expect(shown && "key" in shown).toBe(false);
	});
});
