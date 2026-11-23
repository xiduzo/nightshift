import type { Database } from "@nightshift/db";
import { INBOX_KEEP_MS } from "@nightshift/engine";
import { now as timeNow } from "@nightshift/time";
import {
	listenToRunEvents,
	type RunEventFeed,
} from "./adapters/in/run-event-listener";
import { startTicker } from "./adapters/in/ticker";
import { drizzleDeliveryLog } from "./adapters/out/drizzle-delivery-log";
import { catchUpNotices } from "./application/catch-up-notices";
import { closeNotice } from "./application/close-notice";
import { endDeviceWaits } from "./application/end-device-waits";
import { endQuietHours } from "./application/end-quiet-hours";
import type {
	Audience,
	InApp,
	MayAnswer,
	PersonSettings,
	Pushes,
	PushTargets,
	RunEvents,
	SendsFor,
	SpaceList,
} from "./application/ports";
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

/**
 * The notifier, wired: it reads the run events of this Replica and
 * decides whom to tell, about what, and on which screen. Four events: a
 * new Gate (keyed `runId:stepId`), a run that finished, a run that
 * failed, and a step that waits for an offline Device (keyed
 * `runId:wait:<stepId>`). What it does, rule by rule, is the comment of
 * `Notifier`.
 *
 * The rules are pure functions in `domain/`. Each piece of work is a use
 * case in `application/`, bound here to its ports. The delivery log is
 * the one real adapter of the slice. The listener and the timer of
 * `adapters/in/` put the work in one queue: every piece of work runs one
 * after the other.
 */

/**
 * The run events of this Replica, as the notifier reads them: the
 * engine's landed facts and missed schedules (as feeds), and the open
 * Gates, the runs and the flows that turn severe (as reads). The engine
 * fills it (`engineRunEvents`). The tests use fakes (`./testing`).
 */
export type RunEventSource = RunEvents & RunEventFeed;

/** What the notifier reads and sends through. */
export type NotifierWiring = {
	/** The database of the delivery log. */
	db: Database;
	events: RunEventSource;
	audience: Audience;
	spaces: SpaceList;
	mayAnswer: MayAnswer;
	sendsFor: SendsFor;
	settings: PersonSettings;
	targets: PushTargets;
	inApp: InApp;
	pushes: Pushes;
	now?: () => number;
	/** How often held pushes and the end of quiet hours are checked. Default 15 s. */
	tickMs?: number;
	/** Where errors go. Default: the console. */
	onError?: (message: string, error: unknown) => void;
};

/**
 * The notifier as its owner drives it (`wireNotifier`).
 *
 * The rules:
 * - Who: the Members of the run's Space. A device wait goes only to the
 *   Person the run runs for: "<flow> waits for <device>", with the stop
 *   time. It is withdrawn when the wait is over (`domain/wait-tracker.ts`).
 * - Every open page and app (the in-app stream) hears of every event at
 *   once, also in quiet hours. It shows a notification only when this
 *   daemon sends for the Space, the person wants that event, and it is
 *   not quiet hours.
 * - One sender per Space (`sendsFor`): only that daemon pushes to the
 *   browsers and phones. This computer's own desktop is not a push: the
 *   daemon shows it for every Space it has, also for a Space another
 *   Host keeps and sends for (`LOCAL_KINDS`).
 * - Once per key: the delivery log claims each (Person, key) once.
 * - Quiet hours hold pushes. When they end, each screen gets one push that
 *   says how many of the Gates it held still wait (or the one Gate
 *   itself). Runs that ended meanwhile go without a push.
 * - The active screen first: while the person has a page or the app open,
 *   a push to a phone or a closed browser waits, at most `holdMinutes`.
 *   It goes once the person has no screen open (`isActive`: a page counts
 *   for a minute after it closes, the phone app not after it leaves the
 *   front). A Gate answered meanwhile is not pushed at all. A run that
 *   ended is pushed only when the person closed every screen meanwhile.
 *   The desktop app is a screen of its own: it is not held. Its channel
 *   skips what the person already looks at on this computer (`desktop/`).
 * - Open screens hear when a run changes (`run-changed`): it starts,
 *   sleeps or wakes, moves, stops or ends, or a step starts or ends. That
 *   is quiet: no push, and the item shows nothing. A screen reads the run
 *   again instead of polling.
 * - Answer once, clear everywhere: when a Gate closes, or a device wait
 *   is over, every screen that got it gets a withdraw, and what still
 *   waits is dropped. An answer on its way to the Device that walks the
 *   run closes the Gate here at once (`commandsChanged`). When that Device
 *   refuses it, the Gate waits again without a new push.
 * - A screen that got "N Gates wait for you" counts as told of each of
 *   those Gates: each one's close withdraws it there. The last one's
 *   close also withdraws the summary, while this notifier still runs.
 * - A flow that turns severe under Needs a look (`look:<projectId>:<flow>:<runId>`):
 *   after a run ends, the notifier asks whether that end turned its flow
 *   severe. Only the turn tells: a flow that stays severe tells nobody
 *   again, one that recovered and turns severe again tells again. The
 *   turn comes from the runs themselves, and the log claims its key once,
 *   so a restart never tells it twice. It pushes like a Gate marked Now,
 *   to every Member, and has no item on the open pages (Home shows it).
 * - Lock-screen answers: a push about a Gate its author marked carries its
 *   options, only to a person whose role allows an answer (`mayAnswer`).
 *
 * At start, the open Gates are read: one the log has not told yet (it
 * opened while no notifier listened) is pushed then, the others tell
 * nobody again. A device wait the log told is withdrawn when its run no
 * longer sleeps. A push is claimed before it goes out (`sending`): one a
 * crash cut short goes out at the first check a minute after its claim
 * (`LOST_AFTER_MS`), so a reload never sends one twice that the last
 * notifier still sends. Every piece of work runs one after the other, so
 * two landings never race.
 */
export type Notifier = {
	/**
	 * Listens at once, and reads the open Gates first: the events that land
	 * meanwhile wait for that read. Resolves once it is done.
	 */
	start(): Promise<void>;
	/** Stops listening and checking. What was held stays in the log. */
	stop(): void;
	/** Sends what is due: held pushes, and the end of quiet hours. */
	tick(): Promise<void>;
	/**
	 * A command of the run was kept for the Device that walks it, or that
	 * Device applied or refused it. Reads the run's Gates again: a Gate
	 * with an answer on its way closes everywhere now.
	 */
	commandsChanged(spaceId: string, runId: string): Promise<void>;
	/** Resolves once every piece of work so far is done. For tests. */
	idle(): Promise<void>;
};

export function wireNotifier(wiring: NotifierWiring): Notifier {
	const now = wiring.now ?? timeNow;
	const onError =
		wiring.onError ??
		((message: string, error: unknown) =>
			console.error(`[notifications] ${message}`, error));
	const work = notifierWork(wiring, now, onError);
	const queue = createSerialQueue(onError);
	const enqueue = queue.enqueue;
	let stopped = false;
	let unsubscribe: (() => void) | null = null;
	let stopTicker: (() => void) | null = null;

	return {
		start() {
			stopped = false;
			const ready = enqueue("The open Gates were not read.", work.catchUp);
			unsubscribe = listenToRunEvents(wiring.events, {
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
				everyMs: wiring.tickMs ?? DEFAULT_TICK_MS,
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

/** The use cases of one notifier, bound to its ports, and the state they share. */
function notifierWork(
	wiring: NotifierWiring,
	now: () => number,
	onError: (message: string, error: unknown) => void,
) {
	/** The open Gates this notifier knows, and what the engine said of each. */
	const gates = createGateTracker((spaceId) =>
		wiring.events.openGates(spaceId),
	);
	/** The steps that wait for an offline Device. */
	const waits = createWaitTracker();
	const bundles = createBundles();
	const pruning = createPruneClock();
	const deliveries = drizzleDeliveryLog(wiring.db);
	const { audience, spaces, mayAnswer, sendsFor, targets, inApp, settings } =
		wiring;
	const { pushes, events } = wiring;

	const shared = {
		pushes,
		targets,
		gates,
		mayAnswer,
		now,
		onError,
	};
	const tell = tellPeople({
		...shared,
		sendsFor,
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
			spaces,
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
