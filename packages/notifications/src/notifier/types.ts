import type { InAppChannel, PushChannels, PushTarget } from "../channels";
import type { DeliveryLog } from "../deliveries";
import type { NotificationSettings } from "../settings";
import type { RunEventSource } from "./sources";

/** What the notifier reads and sends through (`NotifierDeps`), and the notifier as its owner drives it (`Notifier`). */

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

/**
 * The notifier as its owner drives it (`createNotifier`).
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
