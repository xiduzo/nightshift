import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
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
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	return { answerCostStore: drizzleAnswerCostStore(db), close: async () => {} };
});
