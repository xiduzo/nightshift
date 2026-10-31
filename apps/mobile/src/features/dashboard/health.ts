import {
	type DashboardSummary,
	formatCost,
	type NightRange,
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
	/** "Mac mini is offline. Its steps wait until it is back." Null when every computer it needs is online. */
	offline: string | null;
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
export function healthOf(
	summary: DashboardSummary,
	offline?: ReadonlyMap<string, readonly string[]>,
): Health | null {
	// An older Host does not say the window: it counted over 30 nights.
	const healthNights = (summary.healthNights as NightRange | undefined) ?? 30;
	const flows = summary.flowHealth;
	if (flows) {
		if (flows.count === 0) return null;
		return {
			title: "Flow health",
			description: `The busiest flows of the last ${healthNights} nights. The bar shows how many of their ended runs finished.`,
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
				offline: offlineText(offline?.get(row.name) ?? []),
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
	const range = summary.nights.find((nights) => nights.nights === healthNights);
	const groups = range?.runs.groups;
	if (!groups || groups.count === 0) return null;
	return {
		title: "Runs per project",
		description: `The busiest projects of the last ${healthNights} nights, over every Space you are in. The bar shows how many of their runs finished.`,
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
			offline: null,
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

/** "A and B": names in a sentence. */
function listed(names: readonly string[]): string {
	if (names.length <= 2) return names.join(" and ");
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What a flow cannot do while a computer it needs is offline: "Mac mini is
 * offline. Its steps wait until it is back." Null when all are online.
 */
export function offlineText(names: readonly string[]): string | null {
	if (names.length === 0) return null;
	if (names.length === 1) {
		return `${names[0]} is offline. Its steps wait until it is back.`;
	}
	return `${listed(names)} are offline. Their steps wait until they are back.`;
}

/**
 * The alert over the flows when a computer they need is offline, with
 * how many flows need it. Null when all are online.
 */
export function offlineAlert(
	offline: ReadonlyMap<string, readonly string[]>,
): { title: string; description: string } | null {
	if (offline.size === 0) return null;
	const computers = [...new Set([...offline.values()].flat())];
	const flows =
		offline.size === 1 ? "1 flow needs" : `${offline.size} flows need`;
	return computers.length === 1
		? {
				title: `${computers[0]} is offline`,
				description: `${flows} it. Those steps wait until it is back.`,
			}
		: {
				title: `${computers.length} computers are offline`,
				description: `${flows} ${listed(computers)}. Those steps wait until they are back.`,
			};
}
