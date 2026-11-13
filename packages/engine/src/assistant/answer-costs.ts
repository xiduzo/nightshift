import type { Database } from "@nightshift/db";
import { answerCost } from "@nightshift/db/schema";
import {
	AGENT_ENTRIES,
	type AgentEntryId,
	type BuiltinAgentId,
} from "@nightshift/flows";
import { asDate, instant } from "@nightshift/time";
import {
	and,
	asc,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	max,
	or,
	sql,
} from "drizzle-orm";

/**
 * What each answer of Night Shift's own agents cost (`answer_cost`): one
 * row per answer, kept when the answer ends. The daemon keeps a row
 * (`keepAnswerCost`), the Spend page reads the rows of a Space
 * (`listAnswerCosts`). Not a run: nothing here is in a run's cost.
 *
 * In a Space a Host keeps, the rows go to that Host and on to the Space's
 * other computers (`sharedAnswerCosts`), so every Replica of the Space
 * reads the same cost. A Space move takes the rows of its Projects along
 * (`spaceMoveBatch`).
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
		key: crypto.randomUUID(),
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

/**
 * The answer costs of the Spaces a Host keeps, between that Host and its
 * Devices. Each call is safe to repeat: a row is one answer by its `key`,
 * on every Replica.
 *
 * - A Device gives its own rows that the Host lacks (`unsent`, then
 *   `sent`), and takes the rows after its cursors (`cursors`, `ingest`):
 *   every row of the Space, its own too, so its cursor is the Host's order.
 * - A Host keeps what a Device gives (`take`) and serves the rows of a
 *   Space after a cursor (`after`), in the order they landed there.
 */
export function sharedAnswerCosts(db: Database) {
	return {
		/** This computer's own rows in `spaces` that their Host lacks, the oldest first. */
		async unsent(
			spaces: readonly string[],
			limit: number,
		): Promise<SentAnswerCost[]> {
			if (spaces.length === 0) return [];
			const rows = await db
				.select()
				.from(answerCost)
				.where(
					and(
						inArray(answerCost.spaceId, [...spaces]),
						isNull(answerCost.deviceId),
						isNull(answerCost.sentAt),
					),
				)
				.orderBy(asc(answerCost.id))
				.limit(limit);
			return rows.map(sentRow);
		},

		/** The Host has these rows. */
		async sent(keys: readonly string[], now: number): Promise<void> {
			if (keys.length === 0) return;
			await db
				.update(answerCost)
				.set({ sentAt: asDate(now) })
				.where(
					and(inArray(answerCost.key, [...keys]), isNull(answerCost.sentAt)),
				);
		},

		/** This Replica's cursor with the Host of each of `spaces`: the last number it has from there. */
		async cursors(spaces: readonly string[]): Promise<Record<string, number>> {
			if (spaces.length === 0) return {};
			const rows = await db
				.select({ spaceId: answerCost.spaceId, seq: max(answerCost.hostSeq) })
				.from(answerCost)
				.where(inArray(answerCost.spaceId, [...spaces]))
				.groupBy(answerCost.spaceId);
			return Object.fromEntries(
				rows.flatMap((row) =>
					row.seq === null ? [] : [[row.spaceId, row.seq] as const],
				),
			);
		},

		/**
		 * Keeps the rows a Host served. A row this computer has (its own
		 * answer, or one served before) takes the Host's number and stays as
		 * it is.
		 */
		async ingest(
			rows: readonly ServedAnswerCost[],
			now: number,
		): Promise<void> {
			for (const row of rows) {
				await db
					.insert(answerCost)
					.values({
						key: row.key,
						spaceId: row.spaceId,
						projectId: row.projectId,
						personId: row.personId,
						agent: row.agent,
						entry: row.entry,
						inputTokens: row.inputTokens,
						outputTokens: row.outputTokens,
						costUsd: row.costUsd,
						at: asDate(row.at),
						deviceId: row.deviceId,
						hostSeq: row.seq,
						sentAt: asDate(now),
					})
					.onConflictDoUpdate({
						target: answerCost.key,
						set: {
							hostSeq: row.seq,
							sentAt: sql`coalesce(${answerCost.sentAt}, ${now})`,
						},
					});
			}
		},

		/**
		 * On a Host: keeps the rows a Device gives, as that Device's and its
		 * Person's. A row it has stays as it is. Returns the keys it has now.
		 */
		async take(
			rows: readonly SentAnswerCost[],
			from: { deviceId: string; personId: string },
		): Promise<string[]> {
			for (const row of rows) {
				await db
					.insert(answerCost)
					.values({
						key: row.key,
						spaceId: row.spaceId,
						projectId: row.projectId,
						personId: from.personId,
						agent: row.agent,
						entry: row.entry,
						inputTokens: row.inputTokens,
						outputTokens: row.outputTokens,
						costUsd: row.costUsd,
						at: asDate(row.at),
						deviceId: from.deviceId,
					})
					.onConflictDoNothing({ target: answerCost.key });
			}
			return rows.map((row) => row.key);
		},

		/**
		 * On a Host: the rows of `spaces` after each Space's cursor, in the
		 * order they landed here, at most `limit`. `selfId` names this Host
		 * as the Device of its own answers.
		 */
		async after(input: {
			spaces: readonly string[];
			cursors: Readonly<Record<string, number>>;
			selfId: string;
			limit: number;
		}): Promise<ServedAnswerCost[]> {
			if (input.spaces.length === 0) return [];
			const rows = await db
				.select()
				.from(answerCost)
				.where(
					or(
						...input.spaces.map((spaceId) =>
							and(
								eq(answerCost.spaceId, spaceId),
								gt(answerCost.id, input.cursors[spaceId] ?? 0),
							),
						),
					),
				)
				.orderBy(asc(answerCost.id))
				.limit(input.limit);
			return rows.map((row) => ({
				...sentRow(row),
				seq: row.id,
				deviceId: row.deviceId ?? input.selfId,
				personId: row.personId,
			}));
		},
	};
}

function sentRow(row: typeof answerCost.$inferSelect): SentAnswerCost {
	return {
		key: row.key,
		spaceId: row.spaceId,
		projectId: row.projectId,
		agent: row.agent,
		entry: row.entry,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		costUsd: row.costUsd,
		at: instant(row.at),
	};
}
