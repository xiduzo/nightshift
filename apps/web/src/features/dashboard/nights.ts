/**
 * Nights, not days: runs start late and go past midnight, so a night runs
 * from noon to noon. A run at 23:00 and one at 01:00 belong to the same night.
 */

/** The noon that starts the night `epochMs` falls in. */
export function nightOf(epochMs: number): number {
	const date = new Date(epochMs);
	if (date.getHours() < 12) date.setDate(date.getDate() - 1);
	date.setHours(12, 0, 0, 0);
	return date.getTime();
}

/** The starts of the last `count` nights, oldest first, ending with tonight. */
export function lastNights(count: number, now = Date.now()): number[] {
	const tonight = nightOf(now);
	return Array.from({ length: count }, (_, index) => {
		const date = new Date(tonight);
		date.setDate(date.getDate() - (count - 1 - index));
		return date.getTime();
	});
}

/** "Wed 15 Oct": the evening a night starts. */
export function formatNight(nightStart: number): string {
	return new Date(nightStart).toLocaleDateString(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

/** "15 Oct": short, for a chart axis. */
export function formatNightShort(nightStart: number): string {
	return new Date(nightStart).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
	});
}

/** Whether `epochMs` falls in the last `count` nights, tonight included. */
export function inLastNights(
	epochMs: number,
	count: number,
	now = Date.now(),
): boolean {
	return nightOf(epochMs) >= (lastNights(count, now)[0] ?? 0);
}
