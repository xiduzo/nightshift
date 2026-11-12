import type { InsightsDb } from "../client";
import { LADDER_KIND, LADDER_RUNGS, usageLadder } from "../schema";
import { asNumber, ratio } from "./numbers";

export type LadderRung = {
	/** A registry value of `nightshift.ladder.rung`. */
	rung: string;
	/** Climbs that landed on this rung. */
	landings: number;
	/** Landings on this rung divided by every landing of the ladder. */
	share: number | null;
	installs: number;
	/**
	 * The average cost in USD of a landing on this rung, every try of the
	 * climb included. Landings with an unknown cost are left out. Null when
	 * no landing has a known cost.
	 */
	costPerLanding: number | null;
};

export type LadderTotals = {
	/** Every climb that landed on this ladder. */
	landings: number;
	/** Installs that sent a landing on this ladder. */
	installs: number;
	/** The average cost in USD of a landing, every try included. */
	costPerLanding: number | null;
	/** The rungs that have a landing, in the registry's order. */
	rungs: LadderRung[];
};

export type Ladders = {
	/** Agents, Subflows, Values by a model and Asks. */
	work: LadderTotals;
	/** Decisions. */
	choice: LadderTotals & {
		/**
		 * Decisions that did not land on a rule. A step end does not say
		 * whether a decider picked, so a person's own climb counts here too.
		 */
		decided: number;
		/** Decisions where a decider fell below its minimum on a try. */
		unsure: number;
		/** Unsure divided by decided. Null when no Decision counts. */
		unsureShare: number | null;
	};
};

type Row = typeof usageLadder.$inferSelect;

function rungIndex(rung: string): number {
	const index = LADDER_RUNGS.indexOf(rung);
	return index === -1 ? LADDER_RUNGS.length : index;
}

function totals(rows: Row[], kind: string): LadderTotals {
	const whole = rows.find((row) => row.kind === kind && row.rung == null);
	const landings = asNumber(whole?.landings);
	return {
		landings,
		installs: asNumber(whole?.installs),
		costPerLanding: ratio(asNumber(whole?.costUsd), asNumber(whole?.costed)),
		rungs: rows
			.flatMap((row) => {
				if (row.kind !== kind || row.rung == null) return [];
				return [
					{
						rung: row.rung,
						landings: asNumber(row.landings),
						share: ratio(asNumber(row.landings), landings),
						installs: asNumber(row.installs),
						costPerLanding: ratio(asNumber(row.costUsd), asNumber(row.costed)),
					},
				];
			})
			.sort((a, b) => rungIndex(a.rung) - rungIndex(b.rung)),
	};
}

/** Where the work landed: the share of each rung, its cost, and how often a decider was not sure enough. */
export async function ladders(db: InsightsDb): Promise<Ladders> {
	const rows = await db.select().from(usageLadder);
	const choice = rows.find(
		(row) => row.kind === LADDER_KIND.choice && row.rung == null,
	);
	const decided = asNumber(choice?.decided);
	const unsure = asNumber(choice?.unsure);
	return {
		work: totals(rows, LADDER_KIND.work),
		choice: {
			...totals(rows, LADDER_KIND.choice),
			decided,
			unsure,
			unsureShare: ratio(unsure, decided),
		},
	};
}
