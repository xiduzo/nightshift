import type {
	KeptAnswerCost,
	SentAnswerCost,
	ServedAnswerCost,
} from "../domain/answer-costs";

/**
 * The driven ports of assistant. The adapters of its own ports sit
 * in `adapters/out/`.
 */

/** What each answer of Night Shift's own agents cost, on this Replica. */
export type AnswerCostStore = {
	/** Keeps what one answer of this computer cost. */
	add(cost: KeptAnswerCost): Promise<void>;
	/** The answers of a Space, the oldest first. `since`: only those that ended at or after it. */
	list(spaceId: string, since?: number): Promise<KeptAnswerCost[]>;
};

/**
 * The answer costs a Host and its Devices exchange. Each call is safe to
 * repeat: a record is one answer by its `key`, on every Replica.
 */
export type AnswerCostShare = {
	/** This computer's own records in `spaces` that their Host lacks, the oldest first, at most `limit`. */
	unsent(spaces: readonly string[], limit: number): Promise<SentAnswerCost[]>;
	/** The Host has these records: marks them sent at `now`. */
	sent(keys: readonly string[], now: number): Promise<void>;
	/** This Replica's cursor with the Host of each of `spaces`: the last number it has from there. */
	cursors(spaces: readonly string[]): Promise<Record<string, number>>;
	/**
	 * Keeps the records a Host served. A record this computer has (its own
	 * answer, or one served before) takes the Host's number and stays as it is.
	 */
	ingest(rows: readonly ServedAnswerCost[], now: number): Promise<void>;
	/**
	 * On a Host: keeps the records a Device gives, as that Device's and its
	 * Person's. A record it has stays as it is. Returns the keys it has now.
	 */
	take(
		rows: readonly SentAnswerCost[],
		from: { deviceId: string; personId: string },
	): Promise<string[]>;
	/**
	 * On a Host: the records of `spaces` after each Space's cursor, in the
	 * order they landed here, at most `limit`. `selfId` names this Host as
	 * the Device of its own answers.
	 */
	after(input: {
		spaces: readonly string[];
		cursors: Readonly<Record<string, number>>;
		selfId: string;
		limit: number;
	}): Promise<ServedAnswerCost[]>;
};
