import { migratedDb } from "@nightshift/db/testing";
import { answerCostShareContract } from "./answer-cost-share.contract";
import { drizzleAnswerCostShare } from "./drizzle-answer-cost-share";
import { drizzleAnswerCostStore } from "./drizzle-answer-cost-store";

/**
 * The contract of `AnswerCostShare`, with the store of the same Replica, on
 * libsql in memory. No use case reads the port, so it has no twin.
 */

answerCostShareContract("over drizzle", async () => {
	const db = await migratedDb();
	return {
		answerCostShare: drizzleAnswerCostShare(db),
		own: drizzleAnswerCostStore(db),
		close: async () => {},
	};
});
