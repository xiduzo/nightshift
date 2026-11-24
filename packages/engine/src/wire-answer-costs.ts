import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import { wireAssistant } from "./assistant";

/**
 * The answer-costs block of the engine's composition (`wire.ts`): what the
 * answers of Night Shift's own agents cost (`assistant/`). Lane AC of the
 * hexagon series owns this file.
 *
 * It gives `keep` (`Engine.keepAnswerCost`), `list` (the Space view's
 * `listAnswerCosts`), and `shared`: `Engine.answerCosts`, the costs a Host
 * and its Devices exchange (`sync.answerCosts`).
 */
export function wireEngineAnswerCosts(deps: {
	db: Database;
	access: Pick<Access, "openSpace">;
}) {
	const cases = wireAssistant(deps);
	return {
		keep: cases.keepAnswerCost,
		list: cases.listAnswerCosts,
		shared: cases.shared,
	};
}
