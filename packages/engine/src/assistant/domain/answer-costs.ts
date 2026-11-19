import {
	AGENT_ENTRIES,
	type AgentEntryId,
	type BuiltinAgentId,
} from "@nightshift/flows";

/**
 * What each answer of Night Shift's own agents cost: one record per
 * answer, kept when the answer ends. The Spend page reads the answers of
 * a Space. Not a run: nothing here is in a run's cost.
 *
 * In a Space a Host keeps, the records go to that Host and on to the
 * Space's other computers, so every Replica of the Space reads the same
 * cost. A record is one answer by its `key`, on every Replica.
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
	"learner",
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

/** An answer's cost as this Replica keeps it: with its key, and the agent and entry as their Replica wrote them. */
export type KeptAnswerCost = Omit<AnswerCost, "agent" | "entry"> & {
	/** The answer on every Replica. */
	key: string;
	/** A newer version may know more agents. */
	agent: string;
	/** A newer version may know more entries. */
	entry: string | null;
};

/** An answer's cost as a Device gives it to the Host that keeps its Space. */
export type SentAnswerCost = {
	/** The answer on every Replica. */
	key: string;
	spaceId: string;
	projectId: string | null;
	/** The built-in agent, as its Replica wrote it: a newer version may know more agents. */
	agent: string;
	entry: string | null;
	inputTokens: number;
	outputTokens: number;
	costUsd: number | null;
	at: number;
};

/** An answer's cost as a Host serves it: with its number there, and who answered. */
export type ServedAnswerCost = SentAnswerCost & {
	/** Its number on the Host: the cursor of the Replica that reads it, per Space. */
	seq: number;
	/** The Device that answered. */
	deviceId: string;
	/** The Person who asked, as the Host knows them. */
	personId: string;
};

const isHelpAgent = (value: string): value is HelpAgent =>
	(HELP_AGENTS as readonly string[]).includes(value);

const isEntry = (value: string): value is AgentEntryId =>
	Object.hasOwn(AGENT_ENTRIES, value);

/**
 * The answers this version can show, in their order. A record of an agent
 * it does not know is left out. An entry it does not know reads as none.
 */
export function knownAnswerCosts(
	kept: readonly KeptAnswerCost[],
): AnswerCost[] {
	return kept.flatMap((cost) =>
		isHelpAgent(cost.agent)
			? [
					{
						at: cost.at,
						agent: cost.agent,
						entry:
							cost.entry !== null && isEntry(cost.entry) ? cost.entry : null,
						projectId: cost.projectId,
						spaceId: cost.spaceId,
						personId: cost.personId,
						inputTokens: cost.inputTokens,
						outputTokens: cost.outputTokens,
						costUsd: cost.costUsd,
					},
				]
			: [],
	);
}
