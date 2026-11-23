import { createSerialQueue, DEFAULT_TICK_MS } from "./domain/notifier-state";
import { baseline, handle, recheck, tellMissed } from "./landing";
import { notifierParts } from "./parts";
import { tick } from "./ticking";
import type { Notifier, NotifierDeps } from "./types";

/**
 * The notifier: it reads the run events of this Replica and decides whom
 * to tell, about what, and on which screen. Four events: a new Gate
 * (keyed `runId:stepId`), a run that finished, a run that failed, and a
 * step that waits for an offline Device (keyed `runId:wait:<stepId>`).
 * What it does, rule by rule, is the comment of `Notifier` (`types.ts`).
 *
 * The rules are pure functions in `domain/`: the words, what a Person
 * wants, the message, which screens a push goes to, when a held push is
 * due, the end of quiet hours, the trackers, the bundles and the queue.
 * The pieces of work read and send through `NotifierDeps`: `telling.ts`
 * tells and takes back, `landing.ts` handles what lands and the start,
 * `ticking.ts` what the timer checks. This file runs them one after the
 * other.
 */

export function createNotifier(deps: NotifierDeps): Notifier {
	const parts = notifierParts(deps);
	const queue = createSerialQueue(parts.onError);
	const enqueue = queue.enqueue;
	let stopped = false;
	let unsubscribe: (() => void) | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;

	return {
		start() {
			stopped = false;
			const ready = enqueue("The open Gates were not read.", () =>
				baseline(parts),
			);
			const offFacts = deps.events.subscribe((facts) => {
				if (stopped) return;
				void enqueue("A run event was not handled.", () =>
					handle(parts, facts),
				);
			});
			const offMissed = deps.events.onScheduleMissed?.((missed) => {
				if (stopped) return;
				void enqueue("A missed schedule was not told.", () =>
					tellMissed(parts, missed),
				);
			});
			unsubscribe = () => {
				offFacts();
				offMissed?.();
			};
			timer = setInterval(() => {
				if (!stopped)
					void enqueue("Held pushes were not sent.", () => tick(parts));
			}, deps.tickMs ?? DEFAULT_TICK_MS);
			return ready;
		},
		stop() {
			stopped = true;
			unsubscribe?.();
			unsubscribe = null;
			if (timer) clearInterval(timer);
			timer = null;
		},
		tick: () => enqueue("Held pushes were not sent.", () => tick(parts)),
		commandsChanged: (spaceId, runId) =>
			stopped
				? Promise.resolve()
				: enqueue("The Gates of a run were not read again.", () =>
						recheck(parts, spaceId, runId),
					),
		idle: () => queue.idle(),
	};
}
