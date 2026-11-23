import type { NoticeKind } from "./words";

/**
 * The rules of a push: which events a Person wants, which screens a push
 * goes to now and which wait, when a held push is due, and what the end
 * of quiet hours sends. Pure: the settings, the screens and the time come
 * in as arguments.
 */

/** A push still `sending` this long after its claim was cut short by a crash. */
export const LOST_AFTER_MS = 60_000;

/** The kinds of push target the notifier reaches. */
export type TargetKind = "web" | "expo" | "desktop";

/**
 * The screens of this computer itself: the desktop notification. The
 * daemon here shows them for every Space this Replica has, not only the
 * Spaces it sends for: a notification on this computer is no second
 * sender of a push. Its channel reaches no other computer.
 */
export const LOCAL_KINDS: ReadonlySet<TargetKind> = new Set(["desktop"]);

/** The switches of a Person's settings for each event. */
export type EventSwitches = {
	events: {
		gateOpened: boolean;
		runFinished: boolean;
		runFailed: boolean;
		deviceWait: boolean;
	};
};

/** Whether the Person wants to hear of this kind of event. */
export function wants(settings: EventSwitches, kind: NoticeKind): boolean {
	if (kind === "gate-opened") return settings.events.gateOpened;
	if (kind === "run-finished") return settings.events.runFinished;
	if (kind === "device-wait") return settings.events.deviceWait;
	// A run that did not start, as a person sees it: like a run that failed.
	if (kind === "schedule-missed") return settings.events.runFailed;
	// A Now alert: the Now urgency of the Person's push settings decides (`tell`).
	if (kind === "flow-needs-a-look") return true;
	return settings.events.runFailed;
}

/** The targets of one push that may get it: all, when this daemon sends for the Space, else this computer's own. */
export function reachable<T extends { kind: TargetKind }>(
	targets: readonly T[],
	sends: boolean,
): T[] {
	return targets.filter((target) => sends || LOCAL_KINDS.has(target.kind));
}

/**
 * The targets that wait while the Person has a screen open, at most
 * `holdMinutes`. The desktop app is a screen of its own: it is not held.
 */
export function heldTargets<T extends { kind: TargetKind }>(
	targets: readonly T[],
	holding: boolean,
): T[] {
	return holding ? targets.filter((t) => t.kind !== "desktop") : [];
}

/** The status of a push once it went to the targets it did not hold. */
export function pushStatus(
	held: number,
	sent: number,
): "held" | "sent" | "dropped" {
	return held > 0 ? "held" : sent > 0 ? "sent" : "dropped";
}

/** A held or sending entry of the delivery log, as the check reads it. */
type Waiting = { personId: string; dueAt: number | null; createdAt: number };

/**
 * The held pushes that are due: their time came, or their Person has no
 * screen open anymore. Then the pushes a crash cut short (`LOST_AFTER_MS`).
 */
export function duePushes<R extends Waiting>(
	held: readonly R[],
	sending: readonly R[],
	at: number,
	isActive: (personId: string) => boolean,
): R[] {
	const lost = sending.filter((row) => row.createdAt + LOST_AFTER_MS <= at);
	return [
		...held.filter(
			(row) =>
				(row.dueAt !== null && row.dueAt <= at) || !isActive(row.personId),
		),
		...lost,
	];
}

/**
 * A held push the open screen showed already: a run's end. No page shows
 * a missed schedule, or a flow that needs a look, as an item: it goes out.
 * `active` is asked only for a run's end.
 */
export function seenOnScreen(kind: NoticeKind, active: () => boolean): boolean {
	return (
		kind !== "gate-opened" &&
		kind !== "schedule-missed" &&
		kind !== "flow-needs-a-look" &&
		active()
	);
}

/**
 * What the end of quiet hours does with the pushes it held for one
 * Person: the Gates, what still waits (a device wait, a missed schedule,
 * a flow that needs a look), and the runs that ended meanwhile, which go
 * without a push.
 */
export function quietEnd<R extends { kind: NoticeKind }>(
	rows: readonly R[],
): { gates: R[]; stillWait: R[]; dropped: R[] } {
	const gates = rows.filter((row) => row.kind === "gate-opened");
	// A wait that is over was withdrawn: what is left still waits.
	// A missed schedule, and a flow that needs a look, are still news
	// when quiet hours end: they go out too.
	const stillWait = rows.filter(
		(row) =>
			row.kind === "device-wait" ||
			row.kind === "schedule-missed" ||
			row.kind === "flow-needs-a-look",
	);
	const dropped = rows.filter(
		(row) =>
			!(
				row.kind === "gate-opened" ||
				row.kind === "device-wait" ||
				row.kind === "schedule-missed" ||
				row.kind === "flow-needs-a-look"
			),
	);
	return { gates, stillWait, dropped };
}

/**
 * The claim of a push before it goes out: every target, until the push
 * went out, so a crash before then leaves them all to the next check.
 * With held targets, when they are due.
 */
export function sendingClaim(
	targetIds: string[],
	holding: boolean,
	at: number,
	holdMinutes: number,
): { status: "sending"; heldFor: string[]; dueAt?: number } {
	return {
		status: "sending",
		heldFor: targetIds,
		...(holding ? { dueAt: at + holdMinutes * 60_000 } : {}),
	};
}

/** The entry of a push once it went to the targets it did not hold. */
export function pushedEntry(sentTo: string[], heldFor: string[], at: number) {
	return {
		sentTo,
		sentAt: sentTo.length > 0 ? at : null,
		heldFor,
		status: pushStatus(heldFor.length, sentTo.length),
	};
}

/** The entry of a held push once the check sent it: `sent` are the targets that got it now. */
export function sentHeldEntry(
	row: { sentTo: string[]; sentAt: number | null },
	sent: string[],
	at: number,
) {
	const sentTo = [...row.sentTo, ...sent];
	return {
		status: sentTo.length > 0 ? ("sent" as const) : ("dropped" as const),
		sentTo,
		heldFor: [],
		sentAt: sent.length > 0 ? at : row.sentAt,
	};
}

/** The entry of a push the end of quiet hours sent to `sent`. */
export function quietEndEntry(sent: string[], at: number) {
	return {
		status: sent.length > 0 ? ("sent" as const) : ("dropped" as const),
		sentTo: sent,
		heldFor: [],
		sentAt: sent.length > 0 ? at : null,
	};
}

/** The entry of a push whose Gate closed, or whose wait is over. */
export function withdrawnEntry(row: { sentTo: string[] }, at: number) {
	return {
		status:
			row.sentTo.length > 0 ? ("withdrawn" as const) : ("dropped" as const),
		heldFor: [],
		withdrawnAt: at,
	};
}

/** The targets that held at least one of the Gates, once each. */
export function heldTargetIds(
	gates: readonly { heldFor: string[] }[],
): string[] {
	return [...new Set(gates.flatMap((row) => row.heldFor))];
}

/** The entries of one Person by Person, in their order. */
export function byPerson<R extends { personId: string }>(
	rows: readonly R[],
): Map<string, R[]> {
	const people = new Map<string, R[]>();
	for (const row of rows) {
		const list = people.get(row.personId) ?? [];
		list.push(row);
		people.set(row.personId, list);
	}
	return people;
}
