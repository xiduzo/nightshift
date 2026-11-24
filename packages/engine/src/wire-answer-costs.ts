import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import {
	type SentAnswerCost,
	type ServedAnswerCost,
	wireAssistant,
} from "./assistant";

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
		shared: {
			/** This computer's own costs in `spaces` that their Host lacks, the oldest first. */
			unsent: (spaces: readonly string[], limit: number) =>
				cases.listUnsentAnswerCosts({ spaces, limit }),
			/** The Host has these costs. */
			sent: (keys: readonly string[], now: number) =>
				cases.markAnswerCostsSent({ keys, now }),
			/** This Replica's cursor with the Host of each of `spaces`. */
			cursors: (spaces: readonly string[]) =>
				cases.readAnswerCostCursors({ spaces }),
			/** Keeps the costs a Host served. */
			ingest: (rows: readonly ServedAnswerCost[], now: number) =>
				cases.ingestServedAnswerCosts({ rows, now }),
			/** On a Host: keeps the costs a Device gives, as that Device's and its Person's. */
			take: (
				rows: readonly SentAnswerCost[],
				from: { deviceId: string; personId: string },
			) => cases.takeSentAnswerCosts({ rows, from }),
			/** On a Host: the costs of `spaces` after each Space's cursor. */
			after: cases.serveAnswerCosts,
		},
	};
}
