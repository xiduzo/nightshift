import type { DashboardSummary, RunStatus } from "@nightshift/client";

/** The nights the health rows cover, as the web dashboard's default range. */
export const HEALTH_NIGHTS = 30;

/** One row of the health list: a flow, or a project over every Space. */
export type HealthRow = {
	key: string;
	label: string;
	/** The share of its runs that finished, 0 to 100. Null when none ended. */
	share: number | null;
	detail: string;
	/** Its last run, when the server tells (a flow's row). */
	last: { status: RunStatus; startedAt: number } | null;
};

export type Health = {
	title: string;
	description: string;
	rows: HealthRow[];
	/** Rows the server left out: the list holds the busiest only. */
	more: number;
};

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
			description: `The busiest flows over the last ${HEALTH_NIGHTS} nights. The bar shows how many of their ended runs finished.`,
			rows: flows.rows.map((row) => ({
				key: row.name,
				label: row.name,
				share: row.rate,
				detail:
					row.rate === null
						? "No run ended yet"
						: `${row.finished} of ${row.ended} finished`,
				last: row.last
					? { status: row.last.status, startedAt: row.last.startedAt }
					: null,
			})),
			more: flows.count - flows.rows.length,
		};
	}
	const range = summary.nights.find(
		(nights) => nights.nights === HEALTH_NIGHTS,
	);
	const groups = range?.runs.groups;
	if (!groups || groups.count === 0) return null;
	return {
		title: "Runs per project",
		description: `The busiest projects over the last ${HEALTH_NIGHTS} nights. The bar shows how many of their runs finished.`,
		rows: groups.rows.map((row) => ({
			key: row.label,
			label: row.label,
			share: row.runs > 0 ? Math.round((row.finished / row.runs) * 100) : null,
			detail: `${row.finished} of ${row.runs} finished, ${row.failed} failed`,
			last: null,
		})),
		more: groups.count - groups.rows.length,
	};
}
