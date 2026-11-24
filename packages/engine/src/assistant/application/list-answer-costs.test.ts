import { describe, expect, test } from "bun:test";
import { allowing } from "../../access/adapters/out/in-memory-access";
import type { Actor } from "../../contract";
import type { KeptAnswerCost } from "../domain/answer-costs";
import { assistantPorts } from "../test-support";
import { listAnswerCosts } from "./list-answer-costs";

/** The use case listAnswerCosts, over a database in memory. */

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
		const ports = await assistantPorts();
		ports.access.members.join("space-a", "ada", "viewer");
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

	test("every Member of the Space may, whatever the role, and nobody else", async () => {
		const ports = await assistantPorts();
		expect(
			await ports.access.whoMay("space-a", (actor) =>
				listAnswerCosts(ports)(actor, { spaceId: "space-a" }),
			),
		).toEqual(allowing("owner", "admin", "member", "viewer"));
	});
});
