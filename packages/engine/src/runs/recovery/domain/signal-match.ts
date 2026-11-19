import { type JsonValue, signalOutcome } from "@nightshift/flows";
import { RunRefusal } from "../../../run-status";

/**
 * Signals from webhooks: a webhook schedule sends a signal to every run of
 * its project that waits for it, not to one run by its id. A run wakes
 * when it sleeps in a Wait on the signal's name, the Wait's key (rendered
 * when the wait began) is absent or equals the signal's, and one of the
 * Wait's rules holds for the event, when it has rules (ADR 8). The
 * webhook's event is the Wait's data.
 */

/** A webhook's signal: its name, its key (null: none) and the event. */
export type ProjectSignal = {
	name: string;
	key: string | null;
	data: JsonValue;
};

/** The sleep of a run, as a signal reads it. */
export type SignalSleep = {
	/** The signal the step waits for, else null. */
	signal: string | null;
	/** The key a webhook signal must have to wake it, else null: any does. */
	signalKey: string | null;
	/** The rules one of which a webhook signal must match to wake it. Empty: any does. */
	signalRules: readonly { outcome: string; when: string }[];
};

/** What a run that moved on reads when a signal comes too late. */
export const NOT_WAITING = "This run does not wait for that signal.";

/** Whether the sleep waits for a signal of this name, and its key when it has one. */
export function waitsFor(
	sleep: SignalSleep | null,
	signal: ProjectSignal,
): boolean {
	return (
		sleep?.signal === signal.name &&
		(sleep.signalKey === null || sleep.signalKey === signal.key)
	);
}

/**
 * Whether the sleep takes this signal: it waits for it (`waitsFor`), and
 * one of its rules holds for the event when it has rules. The Wait node
 * reads the rules again when it wakes, so a check before the wake may
 * leave them out.
 */
export async function takes(
	sleep: SignalSleep | null,
	signal: ProjectSignal,
): Promise<boolean> {
	if (!sleep || !waitsFor(sleep, signal)) return false;
	if (sleep.signalRules.length === 0) return true;
	return (await signalOutcome(sleep.signalRules, signal.data)) !== null;
}

/**
 * The check of a wake by a signal, inside the run's Turn: the run may
 * have moved on since (a stop, a person's signal). It refuses a run that
 * no longer waits for the signal (`wrong-signal`).
 */
export function refuseUnlessWaiting(
	signal: ProjectSignal,
): (run: { sleep: SignalSleep | null }) => void {
	return (run) => {
		if (!waitsFor(run.sleep, signal)) {
			throw new RunRefusal("wrong-signal", NOT_WAITING);
		}
	};
}
