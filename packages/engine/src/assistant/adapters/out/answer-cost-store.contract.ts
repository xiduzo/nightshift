import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AnswerCostStore } from "../../application/ports";
import type { KeptAnswerCost } from "../../domain/answer-costs";

/** One adapter of `AnswerCostStore` to test. */
export type AnswerCostStoreUnderTest = {
	answerCostStore: AnswerCostStore;
	close(): Promise<void>;
};

const kept = (
	key: string,
	fields: Partial<KeptAnswerCost> = {},
): KeptAnswerCost => ({
	key,
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

/**
 * What every adapter of `AnswerCostStore` does.
 * `answer-cost-store.contract.test.ts` runs it on the in-memory adapter
 * and on the real one.
 */
export function answerCostStoreContract(
	name: string,
	make: () => Promise<AnswerCostStoreUnderTest>,
): void {
	describe(`AnswerCostStore contract: ${name}`, () => {
		let under: AnswerCostStoreUnderTest;
		let store: AnswerCostStore;
		beforeEach(async () => {
			under = await make();
			store = under.answerCostStore;
		});
		afterEach(async () => {
			await under.close();
		});

		test("a Space without answers has none", async () => {
			expect(await store.list("space-a")).toEqual([]);
		});

		test("gives back what it kept, by Space, the oldest first, then in the order kept", async () => {
			const late = kept("k1", { at: 3_000, agent: "a-newer-agent" });
			const early = kept("k2", { at: 2_000, entry: null, costUsd: null });
			const same = kept("k3", { at: 3_000, projectId: null });
			for (const each of [late, early, same, kept("k4", { spaceId: "b" })]) {
				await store.add(each);
			}
			expect(await store.list("space-a")).toEqual([early, late, same]);
			expect(await store.list("space-a", 3_000)).toEqual([late, same]);
			expect(await store.list("space-a", 3_001)).toEqual([]);
		});
	});
}
