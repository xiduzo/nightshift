import type { LandedFact, ScheduleMissed } from "@nightshift/engine";

/** Where the run events of this Replica come from: the engine's feeds. */
export type RunEventFeed = {
	/** Calls `listener` with the facts of the run events that land from now on. Returns the unsubscribe. */
	subscribe(listener: (facts: readonly LandedFact[]) => void): () => void;
	/** Calls `listener` when a schedule skips a missed cron time. Absent: no schedule fires here. */
	onScheduleMissed?(listener: (missed: ScheduleMissed) => void): () => void;
};

/** What the listener hands each event to, and when it drops them. */
export type RunEventHandlers = {
	/** The notifier stopped: an event is dropped. */
	stopped(): boolean;
	/** Puts the facts of one landing in the notifier's queue. */
	landed(facts: readonly LandedFact[]): void;
	/** Puts a missed schedule in the notifier's queue. */
	missed(missed: ScheduleMissed): void;
};

/**
 * Listens to the run events and the missed schedules, in this order, and
 * hands each to the notifier while it runs. Returns the unsubscribe of both.
 */
export function listenToRunEvents(
	feed: RunEventFeed,
	handlers: RunEventHandlers,
): () => void {
	const offFacts = feed.subscribe((facts) => {
		if (handlers.stopped()) return;
		handlers.landed(facts);
	});
	const offMissed = feed.onScheduleMissed?.((missed) => {
		if (handlers.stopped()) return;
		handlers.missed(missed);
	});
	return () => {
		offFacts();
		offMissed?.();
	};
}
