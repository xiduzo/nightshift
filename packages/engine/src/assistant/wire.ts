import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import type { Access } from "../access";
import { drizzleAnswerCostShare } from "./adapters/out/drizzle-answer-cost-share";
import { drizzleAnswerCostStore } from "./adapters/out/drizzle-answer-cost-store";
import { ingestServedAnswerCosts } from "./application/ingest-served-answer-costs";
import { keepAnswerCost } from "./application/keep-answer-cost";
import { listAnswerCosts } from "./application/list-answer-costs";
import { listUnsentAnswerCosts } from "./application/list-unsent-answer-costs";
import { markAnswerCostsSent } from "./application/mark-answer-costs-sent";
import { readAnswerCostCursors } from "./application/read-answer-cost-cursors";
import { serveAnswerCosts } from "./application/serve-answer-costs";
import { takeSentAnswerCosts } from "./application/take-sent-answer-costs";

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
	/** A Device: its own answer costs that their Host lacks. */
	listUnsentAnswerCosts: ReturnType<typeof listUnsentAnswerCosts>;
	/** A Device: the Host has these answer costs. */
	markAnswerCostsSent: ReturnType<typeof markAnswerCostsSent>;
	/** A Device: how far it read each Space from its Host. */
	readAnswerCostCursors: ReturnType<typeof readAnswerCostCursors>;
	/** A Device: keeps what its Host served. */
	ingestServedAnswerCosts: ReturnType<typeof ingestServedAnswerCosts>;
	/** A Host: keeps what a Device sent. */
	takeSentAnswerCosts: ReturnType<typeof takeSentAnswerCosts>;
	/** A Host: serves the answer costs after a reader's cursors. */
	serveAnswerCosts: ReturnType<typeof serveAnswerCosts>;
};

export function wireAssistant(deps: AssistantDeps): Assistant {
	const ports = {
		access: deps.access,
		answerCostStore: drizzleAnswerCostStore(deps.db),
		answerCostShare: drizzleAnswerCostShare(deps.db),
		newKey: () => randomUUID(),
	};
	return {
		keepAnswerCost: keepAnswerCost(ports),
		listAnswerCosts: listAnswerCosts(ports),
		listUnsentAnswerCosts: listUnsentAnswerCosts(ports),
		markAnswerCostsSent: markAnswerCostsSent(ports),
		readAnswerCostCursors: readAnswerCostCursors(ports),
		ingestServedAnswerCosts: ingestServedAnswerCosts(ports),
		takeSentAnswerCosts: takeSentAnswerCosts(ports),
		serveAnswerCosts: serveAnswerCosts(ports),
	};
}
