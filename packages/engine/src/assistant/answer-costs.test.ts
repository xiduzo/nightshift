import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { answerCost } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	type AnswerCost,
	keepAnswerCost,
	listAnswerCosts,
} from "./answer-costs";

let sandbox: Sandbox;

beforeEach(async () => {
	sandbox = await createSandbox();
});

afterEach(async () => {
	await sandbox.cleanup();
});

const cost = (fields: Partial<AnswerCost> = {}): AnswerCost => ({
	at: 1_000,
	agent: "builder",
	entry: "flow.build",
	projectId: "p1",
	spaceId: "space-a",
	personId: "ada",
	inputTokens: 1200,
	outputTokens: 300,
	costUsd: 0.42,
	...fields,
});

describe("answer costs", () => {
	test("keeps each answer and lists a Space's, the oldest first", async () => {
		const late = cost({ at: 3_000, agent: "explainer", entry: "run.why" });
		const early = cost({ at: 2_000, agent: "field-writer", costUsd: null });
		await keepAnswerCost(sandbox.db, late);
		await keepAnswerCost(sandbox.db, early);
		await keepAnswerCost(sandbox.db, cost({ spaceId: "space-b" }));

		expect(await listAnswerCosts(sandbox.db, "space-a")).toEqual([early, late]);
		expect(await listAnswerCosts(sandbox.db, "space-b")).toEqual([
			cost({ spaceId: "space-b" }),
		]);
	});

	test("lists only the answers that ended at or after `since`", async () => {
		await keepAnswerCost(sandbox.db, cost({ at: 1_000 }));
		await keepAnswerCost(sandbox.db, cost({ at: 2_000 }));
		await keepAnswerCost(sandbox.db, cost({ at: 3_000 }));

		const listed = await listAnswerCosts(sandbox.db, "space-a", 2_000);
		expect(listed.map((each) => each.at)).toEqual([2_000, 3_000]);
	});

	test("keeps an answer without a project or an entry", async () => {
		const bare = cost({ projectId: null, entry: null });
		await keepAnswerCost(sandbox.db, bare);
		expect(await listAnswerCosts(sandbox.db, "space-a")).toEqual([bare]);
	});

	test("leaves out a row of an agent it does not know, and an entry it does not know", async () => {
		await sandbox.db.insert(answerCost).values([
			{
				spaceId: "space-a",
				personId: "ada",
				agent: "decider",
				inputTokens: 1,
				outputTokens: 1,
				at: asDate(1_000),
			},
			{
				spaceId: "space-a",
				personId: "ada",
				agent: "improver",
				entry: "somewhere.new",
				inputTokens: 1,
				outputTokens: 1,
				at: asDate(2_000),
			},
		]);
		expect(await listAnswerCosts(sandbox.db, "space-a")).toEqual([
			cost({
				at: 2_000,
				agent: "improver",
				entry: null,
				projectId: null,
				inputTokens: 1,
				outputTokens: 1,
				costUsd: null,
			}),
		]);
	});
});
