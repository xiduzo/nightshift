import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import type { Access } from "../access";
import { drizzleAnswerCostShare } from "./adapters/out/drizzle-answer-cost-share";
import { drizzleAnswerCostStore } from "./adapters/out/drizzle-answer-cost-store";
import { keepAnswerCost } from "./application/keep-answer-cost";
import { listAnswerCosts } from "./application/list-answer-costs";
import type { AnswerCostShare } from "./application/ports";

/**
 * The wiring of assistant: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the engine gives assistant: what the real adapters stand on. */
export type AssistantDeps = {
	db: Database;
	/** Who may read what the answers of a Space cost. */
	access: Pick<Access, "openSpace">;
};

/** The use cases of assistant, bound to their ports. */
export type Assistant = {
	/** Keeps what one answer cost on this computer. */
	keepAnswerCost: ReturnType<typeof keepAnswerCost>;
	/** What the answers of a Space cost. */
	listAnswerCosts: ReturnType<typeof listAnswerCosts>;
	/** The answer costs a Host and its Devices exchange: a port, and no use case. Nothing here decides. */
	shared: AnswerCostShare;
};

export function wireAssistant(deps: AssistantDeps): Assistant {
	const ports = {
		access: deps.access,
		answerCostStore: drizzleAnswerCostStore(deps.db),
		newKey: () => randomUUID(),
	};
	return {
		keepAnswerCost: keepAnswerCost(ports),
		listAnswerCosts: listAnswerCosts(ports),
		shared: drizzleAnswerCostShare(deps.db),
	};
}
