import type { Database } from "@nightshift/db";
import { answerCost } from "@nightshift/db/schema";
import {
	AGENT_ENTRIES,
	type AgentEntryId,
	type BuiltinAgentId,
} from "@nightshift/flows";
import { asDate, instant } from "@nightshift/time";
import { and, asc, eq, gte } from "drizzle-orm";

/**
 * What each answer of Night Shift's own agents cost on this computer
 * (`answer_cost`): one row per answer, kept when the answer ends. The
 * daemon keeps a row (`keepAnswerCost`), the Spend page reads the rows of
 * a Space (`listAnswerCosts`). Not a run: nothing here is in a run's cost.
 */

/**
 * The built-in agents that work for the person and cost money per answer.
 * The Decider and the Brief writer work inside a run: the run has their cost.
 */
export const HELP_AGENTS = [
	"builder",
	"improver",
	"explainer",
	"field-writer",
] as const satisfies readonly BuiltinAgentId[];
export type HelpAgent = (typeof HELP_AGENTS)[number];

/** What one answer of a built-in agent cost. */
export type AnswerCost = {
	/** When the answer ended, in ms since the epoch. */
	at: number;
	agent: HelpAgent;
	/** The place in the product that started it. Null when not known. */
	entry: AgentEntryId | null;
	/** The project it was about. Null when not known. */
	projectId: string | null;
	spaceId: string;
	/** The Person who asked. */
	personId: string;
	inputTokens: number;
	outputTokens: number;
	/** Null when the agent did not report its cost. */
	costUsd: number | null;
};

const isHelpAgent = (value: string): value is HelpAgent =>
	(HELP_AGENTS as readonly string[]).includes(value);

const isEntry = (value: string): value is AgentEntryId =>
	Object.hasOwn(AGENT_ENTRIES, value);

/** Keeps what one answer cost. */
export async function keepAnswerCost(
	db: Database,
	cost: AnswerCost,
): Promise<void> {
	await db.insert(answerCost).values({
		spaceId: cost.spaceId,
		projectId: cost.projectId,
		personId: cost.personId,
		agent: cost.agent,
		entry: cost.entry,
		inputTokens: cost.inputTokens,
		outputTokens: cost.outputTokens,
		costUsd: cost.costUsd,
		at: asDate(cost.at),
	});
}

/**
 * What the answers of a Space cost, the oldest first. `since`: only the
 * answers that ended at or after it. A row of an agent this version does
 * not know is left out.
 */
export async function listAnswerCosts(
	db: Database,
	spaceId: string,
	since?: number,
): Promise<AnswerCost[]> {
	const rows = await db
		.select()
		.from(answerCost)
		.where(
			and(
				eq(answerCost.spaceId, spaceId),
				since !== undefined ? gte(answerCost.at, asDate(since)) : undefined,
			),
		)
		.orderBy(asc(answerCost.at), asc(answerCost.id));
	return rows.flatMap((row) =>
		isHelpAgent(row.agent)
			? [
					{
						at: instant(row.at),
						agent: row.agent,
						entry: row.entry !== null && isEntry(row.entry) ? row.entry : null,
						projectId: row.projectId,
						spaceId: row.spaceId,
						personId: row.personId,
						inputTokens: row.inputTokens,
						outputTokens: row.outputTokens,
						costUsd: row.costUsd,
					},
				]
			: [],
	);
}
