import { migratedDb } from "@nightshift/db/testing";
import { answerCostStoreContract } from "./answer-cost-store.contract";
import { drizzleAnswerCostStore } from "./drizzle-answer-cost-store";
import { inMemoryAnswerCostStore } from "./in-memory-answer-cost-store";

/**
 * The contract of `AnswerCostStore`, on both adapters. The real adapter's
 * side runs on libsql in memory.
 */

answerCostStoreContract("in memory", async () => ({
	answerCostStore: inMemoryAnswerCostStore(),
	close: async () => {},
}));

answerCostStoreContract("over drizzle", async () => {
	const db = await migratedDb();
	return { answerCostStore: drizzleAnswerCostStore(db), close: async () => {} };
});
