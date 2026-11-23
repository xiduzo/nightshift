import { INBOX_KEEP_MS } from "@nightshift/engine";
import { now as timeNow } from "@nightshift/time";
import type { InAppChannel, PushChannels, PushTarget } from "../channels";
import type { NotificationSettings } from "../settings";
import { listenToRunEvents } from "./adapters/in/run-event-listener";
import { startTicker } from "./adapters/in/ticker";
import { catchUpNotices } from "./application/catch-up-notices";
import { closeNotice } from "./application/close-notice";
import { endDeviceWaits } from "./application/end-device-waits";
import { endQuietHours } from "./application/end-quiet-hours";
import type { DeliveryLog } from "./application/ports";
import { pruneDeliveries } from "./application/prune-deliveries";
import { runChecks } from "./application/run-checks";
import { sendHeldPushes } from "./application/send-held-pushes";
import { tellLandedFacts } from "./application/tell-landed-facts";
import { tellMissedSchedule } from "./application/tell-missed-schedule";
import { tellPeople } from "./application/tell-people";
import { tellRunChanged } from "./application/tell-run-changed";
import { createGateTracker } from "./domain/gate-tracker";
import {
	createBundles,
	createPruneClock,
	createSerialQueue,
	DEFAULT_TICK_MS,
} from "./domain/notifier-state";
import { createWaitTracker } from "./domain/wait-tracker";
import type { Notifier, RunEventSource } from "./wire";

/**
 * The notifier as `notifier.test.ts` drives it, on deps a test fills:
 * the same use cases, ports and queue as `wireNotifier`, with the delivery
 * log the test gives. It goes with those tests, once each has its twin
 * on in-memory adapters (`application/*.test.ts`).
 */

/** What the notifier reads and sends through. */
export type NotifierDeps = {
	events: RunEventSource;
	/** Who may see the runs of the Space. */
	audience(spaceId: string): Promise<string[]>;
	/** Every Space on this Replica: their open Gates are the baseline. */
	spaces(): Promise<string[]>;
	/** Whether this daemon sends the pushes of the Space (`oneSenderPerSpace`). */
	sendsFor(spaceId: string): Promise<boolean>;
	/**
	 * Whether the Person's role in the Space allows an answer to a Gate.
	 * Default: nobody, so no push carries a Gate's options.
	 */
	mayAnswer?(spaceId: string, personId: string): Promise<boolean>;
	/** A Person's notification settings, or the defaults. */
	settings: { get(personId: string): Promise<NotificationSettings> };
	/** The Person's push targets (a phone whose session ended is forgotten), targets by id, and the forget of one. */
	targets: {
		of(personId: string): Promise<PushTarget[]>;
		byIds(ids: readonly string[]): Promise<PushTarget[]>;
		forget(id: string): Promise<void>;
	};
	deliveries: DeliveryLog;
	inApp: InAppChannel;
	push: PushChannels;
	now?: () => number;
	/** How often held pushes and the end of quiet hours are checked. Default 15 s. */
	tickMs?: number;
	/** Where errors go. Default: the console. */
	onError?: (message: string, error: unknown) => void;
};

export function createNotifier(deps: NotifierDeps): Notifier {
	const now = deps.now ?? timeNow;
	const onError =
		deps.onError ??
		((message: string, error: unknown) =>
			console.error(`[notifications] ${message}`, error));
	const work = notifierWork(deps, now, onError);
	const queue = createSerialQueue(onError);
	const enqueue = queue.enqueue;
	let stopped = false;
	let unsubscribe: (() => void) | null = null;
	let stopTicker: (() => void) | null = null;

	return {
		start() {
			stopped = false;
			const ready = enqueue("The open Gates were not read.", work.catchUp);
			unsubscribe = listenToRunEvents(deps.events, {
				stopped: () => stopped,
				landed: (facts) =>
					void enqueue("A run event was not handled.", () =>
						work.tellLanded(facts),
					),
				missed: (missed) =>
					void enqueue("A missed schedule was not told.", () =>
						work.tellMissed(missed),
					),
			});
			stopTicker = startTicker({
				everyMs: deps.tickMs ?? DEFAULT_TICK_MS,
				stopped: () => stopped,
				tick: () => void enqueue("Held pushes were not sent.", work.checks),
			});
			return ready;
		},
		stop() {
			stopped = true;
			unsubscribe?.();
			unsubscribe = null;
			stopTicker?.();
			stopTicker = null;
		},
		tick: () => enqueue("Held pushes were not sent.", work.checks),
		commandsChanged: (spaceId, runId) =>
			stopped
				? Promise.resolve()
				: enqueue("The Gates of a run were not read again.", () =>
						work.runChanged({ spaceId, runId }),
					),
		idle: () => queue.idle(),
	};
}

/** The use cases of one notifier, bound to the ports its deps fill, and the state they share. */
function notifierWork(
	deps: NotifierDeps,
	now: () => number,
	onError: (message: string, error: unknown) => void,
) {
	/** The open Gates this notifier knows, and what the engine said of each. */
	const gates = createGateTracker((spaceId) => deps.events.openGates(spaceId));
	/** The steps that wait for an offline Device. */
	const waits = createWaitTracker();
	const bundles = createBundles();
	const pruning = createPruneClock();
	const audience = { of: (spaceId: string) => deps.audience(spaceId) };
	const mayAnswer = deps.mayAnswer ?? (async () => false);
	const pushes = deps.push;
	const { targets, deliveries, inApp, settings, events } = deps;

	const shared = {
		pushes,
		targets,
		gates,
		mayAnswer: {
			allows: (spaceId: string, personId: string) =>
				mayAnswer(spaceId, personId),
		},
		now,
		onError,
	};
	const tell = tellPeople({
		...shared,
		sendsFor: { sends: (spaceId) => deps.sendsFor(spaceId) },
		audience,
		settings,
		inApp,
		deliveries,
	});
	const close = closeNotice({
		...shared,
		audience,
		inApp,
		deliveries,
		bundles,
	});
	return {
		catchUp: catchUpNotices({
			spaces: { all: () => deps.spaces() },
			gates,
			waits,
			deliveries,
			events,
			tell,
			close,
		}),
		tellLanded: tellLandedFacts({
			gates,
			waits,
			events,
			audience,
			inApp,
			now,
			tell,
			close,
		}),
		tellMissed: tellMissedSchedule({ now, tell }),
		runChanged: tellRunChanged({ gates, close }),
		checks: runChecks({
			now,
			endWaits: endDeviceWaits({ waits, close }),
			sendHeld: sendHeldPushes({ ...shared, deliveries, inApp, settings }),
			endQuiet: endQuietHours({ ...shared, deliveries, settings, bundles }),
			prune: pruneDeliveries({
				pruning,
				deliveries,
				inboxKeepMs: INBOX_KEEP_MS,
			}),
		}),
	};
}
