import {
	type DashboardSummary,
	formatCost,
	HEALTH_NIGHTS,
	type RunStatus,
} from "@nightshift/client";

/** One row of the health list: a flow, or a project over every Space. */
export type HealthRow = {
	key: string;
	label: string;
	/** A flow's name shows in mono, a project's name does not. */
	mono: boolean;
	/** The share of its runs that finished, 0 to 100. Null when none ended. */
	share: number | null;
	/** "3 of 4 finished · 1 failed". */
	detail: string;
	/** A second line: "Typical cost $0.40 · 1 did not finish". Null when there is nothing to add. */
	more: string | null;
	/** Its last run, when the server tells (a flow's row). */
	last: { runId: string; status: RunStatus; startedAt: number } | null;
};

export type Health = {
	title: string;
	description: string;
	rows: HealthRow[];
	/** Rows the server left out: the list holds the busiest only. */
	hidden: number;
};

function parts(list: readonly (string | null)[]): string | null {
	const shown = list.filter((part): part is string => part !== null);
	return shown.length > 0 ? shown.join(" · ") : null;
}

/**
 * How the flows did (one project), or how the projects did (every Space).
 * The server sends the flow health of a project, and the runs per project
 * over all of them, with their names. Null when there is nothing to show.
 */
export function healthOf(summary: DashboardSummary): Health | null {
	const flows = summary.flowHealth;
	if (flows) {
		if (flows.count === 0) return null;
		return {
			title: "Flow health",
			description: `The busiest flows of the last ${HEALTH_NIGHTS} nights. The bar shows how many of their ended runs finished.`,
			rows: flows.rows.map((row) => ({
				key: row.name,
				label: row.name,
				mono: true,
				share: row.rate,
				detail:
					row.rate === null
						? "No run ended yet"
						: `${row.finished} of ${row.ended} finished`,
				more: parts([
					row.cost ? `Typical cost ${formatCost(row.cost.median)}` : null,
					row.unfinished.count > 0
						? `${row.unfinished.count} did not finish`
						: null,
				]),
				last: row.last
					? {
							runId: row.last.runId,
							status: row.last.status,
							startedAt: row.last.startedAt,
						}
					: null,
			})),
			hidden: flows.count - flows.rows.length,
		};
	}
	const range = summary.nights.find(
		(nights) => nights.nights === HEALTH_NIGHTS,
	);
	const groups = range?.runs.groups;
	if (!groups || groups.count === 0) return null;
	return {
		title: "Runs per project",
		description: `The busiest projects of the last ${HEALTH_NIGHTS} nights, over every Space you are in. The bar shows how many of their runs finished.`,
		rows: groups.rows.map((row) => ({
			key: row.label,
			label: row.label,
			mono: false,
			share: row.runs > 0 ? Math.round((row.finished / row.runs) * 100) : null,
			detail: parts([
				`${row.finished} of ${row.runs} finished`,
				row.failed > 0 ? `${row.failed} failed` : null,
			]) as string,
			more: null,
			last: null,
		})),
		hidden: groups.count - groups.rows.length,
	};
}

/** "2 more are not shown." Null when every row shows. */
export function hiddenText(hidden: number): string | null {
	if (hidden <= 0) return null;
	return hidden === 1
		? "1 more is not shown."
		: `${hidden} more are not shown.`;
}
