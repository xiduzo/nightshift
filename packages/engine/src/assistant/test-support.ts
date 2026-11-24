import { migratedDb } from "@nightshift/db/testing";
import { inMemoryAccess } from "../access/adapters/out/in-memory-access";
import { drizzleAnswerCostStore } from "./adapters/out/drizzle-answer-cost-store";

/** Every port of assistant, the store over a database in memory: where each use-case test starts. */
export async function assistantPorts() {
	let keys = 0;
	return {
		access: inMemoryAccess(),
		answerCostStore: drizzleAnswerCostStore(await migratedDb()),
		newKey: () => `key-${++keys}`,
	};
}
