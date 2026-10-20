import type { RunSummary } from "@/shared/api";

export const HOUR_MS = 60 * 60 * 1000;

/** Whether a run is still open: at work, waiting at a Gate, or asleep. */
export function isOpen(run: RunSummary): boolean {
	return (
		run.status === "running" ||
		run.status === "waiting" ||
		run.status === "sleeping"
	);
}

/** The starts of the last `count` hours, oldest first, ending with this hour. */
export function lastHours(count: number, now = Date.now()): number[] {
	const date = new Date(now);
	date.setMinutes(0, 0, 0);
	const thisHour = date.getTime();
	return Array.from(
		{ length: count },
		(_, index) => thisHour - (count - 1 - index) * HOUR_MS,
	);
}

/**
 * When a run was at work. An open run works until now; a run that never
 * ended (interrupted) counts for its start only.
 */
function spanOf(run: RunSummary, now: number) {
	return {
		from: run.createdAt,
		to: run.endedAt ?? (isOpen(run) ? now : run.createdAt),
	};
}

/** How many runs were at work in each of the last `count` hours. */
export function activePerHour(runs: RunSummary[], count: number, now: number) {
	const spans = runs.map((run) => spanOf(run, now));
	return lastHours(count, now).map((hour) => ({
		hour,
		active: spans.filter(
			(span) => span.from < hour + HOUR_MS && span.to >= hour,
		).length,
	}));
}

/**
 * How many Gates waited for an answer in each of the last `count` hours,
 * answered ones too. A Gate of a run that never ended counts for the hour
 * it opened only.
 */
export function gatesPerHour(runs: RunSummary[], count: number, now: number) {
	const spans = runs.flatMap((run) =>
		run.gates.map((gate) => ({
			from: gate.openedAt,
			to: gate.closedAt ?? (run.status === "waiting" ? now : gate.openedAt),
		})),
	);
	return lastHours(count, now).map((hour) => ({
		hour,
		gates: spans.filter((span) => span.from < hour + HOUR_MS && span.to >= hour)
			.length,
	}));
}
