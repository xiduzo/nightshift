import type { Schedule } from "@nightshift/flows";

/** A schedule as a split leaves it: off, and of no Person. */
export function pausedForm(schedule: Schedule): Schedule {
	const { person: _person, ...rest } = schedule;
	return { ...rest, enabled: false };
}

/** Whether the schedule is still as the pause of `was` left it: nobody changed it. */
export function isPausedForm(schedule: Schedule, was: Schedule): boolean {
	return canonical(schedule) === canonical(pausedForm(was));
}

/** A value as text: the same for the same fields in another order. */
function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, field) =>
		field !== null && typeof field === "object" && !Array.isArray(field)
			? Object.fromEntries(
					Object.entries(field).sort(([a], [b]) => (a < b ? -1 : 1)),
				)
			: field,
	);
}
