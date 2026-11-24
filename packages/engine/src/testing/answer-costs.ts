import type { Database } from "@nightshift/db";
import { inMemoryAccess } from "../access/adapters/out/in-memory-access";
import { wireEngineAnswerCosts } from "../wire-answer-costs";

/**
 * The answer costs of a Replica on this database, as `Engine.answerCosts`
 * gives them: for a test that has a database and no engine.
 */
export function answerCostsOn(db: Database) {
	return wireEngineAnswerCosts({ db, access: inMemoryAccess() }).shared;
}
