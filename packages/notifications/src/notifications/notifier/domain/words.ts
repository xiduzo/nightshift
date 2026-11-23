import { formatClock } from "@nightshift/time";

import { type LookSignal, signalTitle } from "../../../contract";

/**
 * The words of the notifications: one short sentence for the person ("A
 * Gate waits for you"), and a second line where the kind needs one. A
 * screen asks Night Shift for the rest.
 */

/** What happened, as the delivery log names it (`NoticeKind` of `deliveries/`). */
export type NoticeKind =
	| "gate-opened"
	| "run-finished"
	| "run-failed"
	| "device-wait"
	| "schedule-missed"
	| "flow-needs-a-look";

/** The sentence each notification says. */
export function titleOf(kind: NoticeKind): string {
	switch (kind) {
		case "gate-opened":
			return "A Gate waits for you";
		case "run-finished":
			return "A run finished";
		case "run-failed":
			return "A run failed";
		case "device-wait":
			return "A step waits for a device";
		case "schedule-missed":
			return "A schedule did not start";
		case "flow-needs-a-look":
			return "A flow needs a look";
	}
}

/** The sentence of the notification at the end of quiet hours. */
export function gatesWaitingTitle(count: number): string {
	return count === 1 ? "1 Gate waits for you" : `${count} Gates wait for you`;
}

/** What one notification says: its sentence, and a second line. */
export type NoticeWords = { title: string; body?: string };

/**
 * The words of a missed schedule: "A schedule did not start", and "<flow>
 * was due at 22:30. Night Shift was off at that time." on the person's
 * clock. A time a day or more ago says its day too.
 */
export function scheduleMissedWords(missed: {
	flow: string;
	at: number;
	timeZone: string;
	now: number;
}): NoticeWords {
	// `formatClock` adds the day to a time a day or more away: here, in the past.
	const away = Math.max(0, missed.now - missed.at);
	const due = formatClock(missed.at, missed.at - away, missed.timeZone);
	// "22:30", or "Mon 2 Nov at 22:30".
	const when = due.includes(" at ") ? `on ${due}` : `at ${due}`;
	return {
		title: titleOf("schedule-missed"),
		body: `${missed.flow} was due ${when}. Night Shift was off at that time.`,
	};
}

/**
 * The words of a flow that turned severe under Needs a look: the flow's
 * name, and "Needs a look. Failed 2 runs in a row." in the words of its
 * row on Home.
 */
export function needsALookWords(turn: {
	flow: string;
	signal: LookSignal;
}): NoticeWords {
	return {
		title: turn.flow,
		body: `Needs a look. ${signalTitle(turn.signal)}.`,
	};
}

/**
 * The words of a device wait: "<flow> waits for <device>", and what
 * happens next. A Device of an older version does not say its name: "a
 * device".
 */
export function deviceWaitWords(wait: {
	flow: string;
	device: string | null;
	stopAt: number | null;
	timeZone: string;
	now: number;
}): NoticeWords {
	const title = `${wait.flow} waits for ${wait.device ?? "a device"}`;
	const next = "The step starts when the device is back.";
	if (wait.stopAt === null || wait.stopAt <= wait.now) {
		return { title, body: next };
	}
	const at = formatClock(wait.stopAt, wait.now, wait.timeZone);
	return {
		title,
		body: `${next} If it is not back by ${at}, the run stops.`,
	};
}
