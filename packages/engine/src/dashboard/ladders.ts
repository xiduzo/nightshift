import type { RungBy } from "../log";
import type { Ladder, Rung, RunRung } from "../read";
import { topRows } from "./stats";
import type {
	ChoiceLadderSummary,
	FlowLadders,
	FlowRangeLadders,
	KnownCost,
	LadderRungRow,
	LadderSummary,
	NodeLadder,
} from "./types";

/**
 * Where the work of a flow landed (Q31), from its runs' ladder rows
 * (`RunMetrics.ladder`): per ladder, the rungs and how often a climb
 * landed on each, and what a landing there cost on average. Tiers of the
 * same name merge over every node, so "Sonnet" is one rung of the flow.
 *
 * A landing's cost holds every try before it, and a Subflow's landing
 * holds what its called flow cost. So a rung's cost is an average per
 * landing: never a sum over a flow's rungs, which would count a Subflow
 * and the Agent inside it twice.
 */

/** The ladder's order: the cheapest rung first, nothing held last. */
const RUNG_ORDER: Record<Rung, number> = {
	rule: 0,
	first: 1,
	later: 2,
	person: 3,
	deadline: 4,
	none: 5,
};

/** One rung of a ladder while its landings add up. */
type Tally = {
	rung: Rung;
	by: RungBy;
	tier: string | null;
	landed: number;
	costUsd: number;
	costEstimated: boolean;
	costMissing: number;
	picked: number;
	unsure: number;
};

/**
 * The rung a row adds to. A tier merges by its name, over the nodes and
 * over first and later. A node without a Cascade merges by who works on
 * it. A person, a deadline, a rule and `none` are one rung each.
 */
function rungKey(row: RunRung): string {
	if (row.rung === "first" || row.rung === "later") {
		return row.tier !== null ? `tier\n${row.tier}` : `${row.rung}\n${row.by}`;
	}
	return row.rung;
}

/** Adds a row to the tally of its rung. */
function add(tallies: Map<string, Tally>, row: RunRung): void {
	const key = rungKey(row);
	const tally = tallies.get(key) ?? {
		rung: row.rung,
		// `none` merges over who tried: the first row's.
		by: row.by,
		tier: key === row.rung ? null : row.tier,
		landed: 0,
		costUsd: 0,
		costEstimated: false,
		costMissing: 0,
		picked: 0,
		unsure: 0,
	};
	// A tier that is first on one node and later on another: the lower one.
	if (RUNG_ORDER[row.rung] < RUNG_ORDER[tally.rung]) tally.rung = row.rung;
	tally.landed += row.landed;
	tally.costUsd += row.costUsd;
	tally.costEstimated ||= row.costEstimated;
	tally.costMissing += row.costMissing;
	tally.picked += row.picked ?? 0;
	tally.unsure += row.unsure ?? 0;
	tallies.set(key, tally);
}

/** What one landing cost on average. `costMissing` counts the tries without a cost. */
function perLanding(tally: {
	landed: number;
	costUsd: number;
	costEstimated: boolean;
	costMissing: number;
}): KnownCost {
	return {
		costUsd: tally.landed > 0 ? tally.costUsd / tally.landed : 0,
		costEstimated: tally.costEstimated,
		costMissing: tally.costMissing,
	};
}

/** The rungs in ladder order, the most landings first within a rung. */
function rungRows(tallies: Iterable<Tally>): LadderRungRow[] {
	return [...tallies]
		.sort(
			(a, b) =>
				RUNG_ORDER[a.rung] - RUNG_ORDER[b.rung] ||
				b.landed - a.landed ||
				(a.tier ?? a.by).localeCompare(b.tier ?? b.by),
		)
		.map((tally) => ({
			rung: tally.rung,
			by: tally.by,
			tier: tally.tier,
			landed: tally.landed,
			costPerLanding: perLanding(tally),
		}));
}

/** The rows of one ladder added up. Null when nothing landed on it. */
function summaryOf(rows: readonly RunRung[]): LadderSummary | null {
	const tallies = new Map<string, Tally>();
	for (const row of rows) add(tallies, row);
	const landed = rows.reduce((sum, row) => sum + row.landed, 0);
	return landed > 0 ? { landed, rungs: rungRows(tallies.values()) } : null;
}

/** The choice ladder, with how sure its deciders were. */
function choiceOf(rows: readonly RunRung[]): ChoiceLadderSummary | null {
	const summary = summaryOf(rows);
	if (!summary) return null;
	return {
		...summary,
		picked: rows.reduce((sum, row) => sum + (row.picked ?? 0), 0),
		unsure: rows.reduce((sum, row) => sum + (row.unsure ?? 0), 0),
	};
}

/** Where the work landed, over the ladder rows of a flow's own runs. */
export function flowLadders(rows: readonly RunRung[]): FlowLadders {
	return {
		work: summaryOf(rows.filter((row) => row.ladder === "work")),
		choice: choiceOf(rows.filter((row) => row.ladder === "choice")),
	};
}

/** Where the work landed, and the nodes that landed most. */
export function flowRangeLadders(rows: readonly RunRung[]): FlowRangeLadders {
	return { ...flowLadders(rows), nodes: topRows(nodeLadders(rows)) };
}

/** One ladder row per node (and the Subflow nodes it ran in), the most landings first. */
function nodeLadders(rows: readonly RunRung[]): NodeLadder[] {
	const byNode = new Map<
		string,
		{ ladder: Ladder; nodeId: string; via?: string; rows: RunRung[] }
	>();
	for (const row of rows) {
		const key = `${row.ladder}/${row.via ?? ""}/${row.nodeId}`;
		const node = byNode.get(key) ?? {
			ladder: row.ladder,
			nodeId: row.nodeId,
			...(row.via !== undefined ? { via: row.via } : {}),
			rows: [],
		};
		node.rows.push(row);
		byNode.set(key, node);
	}
	return [...byNode.entries()]
		.flatMap(([key, node]): NodeLadder[] => {
			const choice = node.ladder === "choice" ? choiceOf(node.rows) : null;
			const summary = choice ?? summaryOf(node.rows);
			if (!summary) return [];
			return [
				{
					key,
					ladder: node.ladder,
					nodeId: node.nodeId,
					...(node.via !== undefined ? { via: node.via } : {}),
					landed: summary.landed,
					// One node's rungs are its own landings: they add up.
					costPerLanding: perLanding({
						landed: summary.landed,
						costUsd: node.rows.reduce((sum, row) => sum + row.costUsd, 0),
						costEstimated: node.rows.some((row) => row.costEstimated),
						costMissing: node.rows.reduce(
							(sum, row) => sum + row.costMissing,
							0,
						),
					}),
					rungs: summary.rungs,
					...(choice ? { picked: choice.picked, unsure: choice.unsure } : {}),
				},
			];
		})
		.sort(
			(a, b) =>
				b.landed - a.landed ||
				a.nodeId.localeCompare(b.nodeId) ||
				a.key.localeCompare(b.key),
		);
}
