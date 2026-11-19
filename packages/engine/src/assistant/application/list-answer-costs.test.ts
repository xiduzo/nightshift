import { describe, expect, test } from "bun:test";
import { type Actor, NIGHT_SHIFT } from "../../contract";
import { inMemoryAssistantPorts } from "../adapters/out/in-memory-neighbours";
import type { KeptAnswerCost } from "../domain/answer-costs";
import { listAnswerCosts } from "./list-answer-costs";

/** The use case listAnswerCosts, on in-memory adapters. */

const ADA: Actor = { personId: "ada", door: "session" };

const kept = (key: string, fields: Partial<KeptAnswerCost> = {}) => ({
	key,
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

describe("listAnswerCosts", () => {
	test("the answers of the Space this version knows, the oldest first, since a time", async () => {
		const ports = inMemoryAssistantPorts();
		await ports.answerCostStore.add(kept("k1", { at: 3_000 }));
		await ports.answerCostStore.add(kept("k2", { at: 2_000 }));
		await ports.answerCostStore.add(kept("k3", { agent: "decider" }));
		await ports.answerCostStore.add(kept("k4", { spaceId: "space-b" }));

		const list = listAnswerCosts(ports);
		const ats = async (since?: number) =>
			(
				await list(ADA, {
					spaceId: "space-a",
					...(since === undefined ? {} : { since }),
				})
			).map((cost) => cost.at);
		expect(await ats()).toEqual([2_000, 3_000]);
		expect(await ats(2_500)).toEqual([3_000]);
	});

	test("checks no role, as before: Night Shift and a Person read the same", async () => {
		const ports = inMemoryAssistantPorts();
		await ports.answerCostStore.add(kept("k1"));
		const list = listAnswerCosts(ports);
		expect(await list(NIGHT_SHIFT, { spaceId: "space-a" })).toEqual(
			await list(
				{ personId: "anyone", door: "device-key" },
				{
					spaceId: "space-a",
				},
			),
		);
	});
});
