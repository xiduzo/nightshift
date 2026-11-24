import type { Schedule } from "@nightshift/flows";
import { isRecord } from "@nightshift/flows";

/**
 * The schedules that a leave of a Host paused on this computer only. The
 * flow document keeps each as the Host has it, so no pause ever reaches
 * the Host. Here it reads as off, and of no Person, until a person turns
 * it on here or this computer joins the Host again.
 */

/** The schedule as it reads here. */
export function readHere(
	schedule: Schedule,
	paused: ReadonlySet<string>,
): Schedule {
	return paused.has(schedule.id) ? pausedForm(schedule) : schedule;
}

/**
 * What a save writes of the schedules a person saved here, and which of
 * them are not paused here any more: turned on, or removed. One that
 * stays off keeps what the document says of it.
 */
export function savedHere(
	saved: readonly Schedule[],
	stored: readonly Schedule[],
	paused: ReadonlySet<string>,
): { schedules: Schedule[]; ended: string[] } {
	const before = new Map(stored.map((s) => [s.id, s]));
	const ended = [...paused].filter(
		(id) => !saved.some((s) => s.id === id && !s.enabled),
	);
	const schedules = saved.map((schedule) => {
		const was = before.get(schedule.id);
		if (!was?.enabled || schedule.enabled || !paused.has(schedule.id)) {
			return schedule;
		}
		const kept = {
			...schedule,
			enabled: true,
			...(was.person === undefined ? {} : { person: was.person }),
		};
		// A save of the list gives a schedule the clock of its saver.
		if (was.timeZone === undefined) {
			const { timeZone: _clock, ...rest } = kept;
			if (canonical(rest) === canonical(was)) return was;
		}
		return kept;
	});
	return { schedules, ended };
}

/** A schedule that does not run: off, and of no Person. */
export function pausedForm(schedule: Schedule): Schedule {
	if (!schedule.enabled) return schedule;
	const { person: _person, ...rest } = schedule;
	return { ...rest, enabled: false };
}

/** A value as text: the same for the same fields in another order. */
function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, field) =>
		isRecord(field)
			? Object.fromEntries(
					Object.entries(field).sort(([a], [b]) => (a < b ? -1 : 1)),
				)
			: field,
	);
}
