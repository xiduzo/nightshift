import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { answerCostShareContract } from "./answer-cost-share.contract";
import { drizzleAnswerCostShare } from "./drizzle-answer-cost-share";
import { drizzleAnswerCostStore } from "./drizzle-answer-cost-store";
import { inMemoryAnswerCostShare } from "./in-memory-answer-cost-share";
import {
	answerCostRecords,
	inMemoryAnswerCostStore,
} from "./in-memory-answer-cost-store";

/**
 * The contract of `AnswerCostShare`, on both adapters, each with the
 * store of the same Replica. The real adapter's side runs on libsql in
 * memory.
 */

answerCostShareContract("in memory", async () => {
	const records = answerCostRecords();
	return {
		answerCostShare: inMemoryAnswerCostShare(records),
		own: inMemoryAnswerCostStore(records),
		close: async () => {},
	};
});

answerCostShareContract("over drizzle", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	return {
		answerCostShare: drizzleAnswerCostShare(db),
		own: drizzleAnswerCostStore(db),
		close: async () => {},
	};
});
