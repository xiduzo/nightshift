import type { Database } from "@nightshift/db";
import { wireEngineAnswerCosts } from "../wire-answer-costs";

/**
 * The answer costs of a Replica on this database, as `Engine.answerCosts`
 * gives them: for a test that has a database and no engine.
 */
export function answerCostsOn(db: Database) {
	return wireEngineAnswerCosts({ db }).shared;
}
