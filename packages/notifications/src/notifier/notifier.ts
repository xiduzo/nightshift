import {
	type GateFacts,
	gatesWaitingTitle,
	type InAppChannel,
	type NotificationMessage,
	type PushChannels,
	titleOf,
} from "../channels";
import { parseGateKey, runEndKey, waitingKey } from "../contract";
import type { Claim, Delivery, DeliveryLog, NoticeKind } from "../deliveries";
import {
	inQuietHours,
	type NotificationSettings,
	type SettingsStore,
} from "../settings";
import type { PushTarget, TargetStore } from "../targets";
import { createGateTracker } from "./gate-tracker";
import type { RunEvent, RunEventSource } from "./sources";

/**
 * The notifier: it reads the run events of this Replica and decides whom
 * to tell, about what, and on which screen. Three events: a new Gate
 * (keyed `runId:stepId`), a run that finished, a run that failed.
 *
 * The rules:
 * - Who: the Members of the run's Space.
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
 * - Answer once, clear everywhere: when a Gate closes, every screen that
 *   got it gets a withdraw, and what still waits is dropped.
 * - Lock-screen answers: a push about a Gate its author marked carries its
 *   options, only to a person whose role allows an answer (`mayAnswer`).
 *
 * At start, the open Gates are read: one the log has not told yet (it
 * opened while no notifier listened) is pushed then, the others tell
 * nobody again. Every piece of work runs one after the other, so two
 * landings never race.
 */

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
	settings: Pick<SettingsStore, "get">;
	targets: Pick<TargetStore, "of" | "byIds" | "forget">;
	deliveries: DeliveryLog;
	inApp: InAppChannel;
	push: PushChannels;
	now?: () => number;
	/** How often held pushes and the end of quiet hours are checked. Default 15 s. */
	tickMs?: number;
	/** Where errors go. Default: the console. */
	onError?: (message: string, error: unknown) => void;
};

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
	/** Resolves once every piece of work so far is done. For tests. */
	idle(): Promise<void>;
};

const DEFAULT_TICK_MS = 15_000;

/**
 * The screens of this computer itself: the desktop notification. The
 * daemon here shows them for every Space this Replica has, not only the
 * Spaces it sends for: a notification on this computer is no second
 * sender of a push. Its channel reaches no other computer.
 */
const LOCAL_KINDS: ReadonlySet<PushTarget["kind"]> = new Set(["desktop"]);

/**
 * The run events that change what a list of runs shows: the status, the
 * step that runs, the Walker, a stop that waits. A Gate and a run's end
 * have items of their own. Cost and transcript events do not count.
 */
const RUN_CHANGES: ReadonlySet<string> = new Set([
	"RunStarted",
	"RunResumed",
	"RunEnded",
	"StepStarted",
	"StepReopened",
	"StepEnded",
	"WaitStarted",
	"WaitEnded",
	"WalkerMoved",
	"HandedOff",
	"StopRequested",
	"StopAfterStepRequested",
	"StopAfterStepCancelled",
]);

export function createNotifier(deps: NotifierDeps): Notifier {
	const now = deps.now ?? Date.now;
	const onError =
		deps.onError ??
		((message: string, error: unknown) =>
			console.error(`[notifications] ${message}`, error));
	/** The open Gates this notifier knows, and what the engine said of each. */
	const gates = createGateTracker((spaceId) => deps.events.openGates(spaceId));
	const mayAnswer = deps.mayAnswer ?? (async () => false);
	let queue: Promise<void> = Promise.resolve();
	let stopped = false;
	let unsubscribe: (() => void) | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;

	function enqueue(what: string, job: () => Promise<void>): Promise<void> {
		queue = queue.then(job).catch((error) => onError(what, error));
		return queue;
	}

	function message(
		kind: NoticeKind,
		key: string,
		ids: { spaceId: string; runId: string; stepId: string | null },
		alert: boolean,
	): NotificationMessage {
		return {
			key,
			kind,
			...ids,
			title: titleOf(kind),
			alert,
			count: null,
			at: now(),
		};
	}

	/** What a push about the Gate may show the Person. */
	async function gateFacts(
		key: string,
		spaceId: string,
		personId: string,
	): Promise<GateFacts> {
		const ref = gates.factsOf(spaceId, key);
		if (!ref?.lockScreen || !(await mayAnswer(spaceId, personId))) {
			return { lockScreen: false, options: [] };
		}
		return {
			lockScreen: true,
			options: (ref.choices ?? []).map((name) => ({ id: name, label: name })),
		};
	}

	/** The message a push sends: a Gate's adds what its notification may show. */
	async function pushMessage(
		kind: NoticeKind,
		key: string,
		ids: { spaceId: string; runId: string; stepId: string | null },
		personId: string,
	): Promise<NotificationMessage> {
		const msg = message(kind, key, ids, true);
		if (kind !== "gate-opened") return msg;
		return { ...msg, gate: await gateFacts(key, ids.spaceId, personId) };
	}

	function wants(settings: NotificationSettings, kind: NoticeKind): boolean {
		if (kind === "gate-opened") return settings.events.gateOpened;
		if (kind === "run-finished") return settings.events.runFinished;
		return settings.events.runFailed;
	}

	/** The Person's push targets their settings allow and a channel can reach. */
	async function pushTargets(
		personId: string,
		settings: NotificationSettings,
	): Promise<PushTarget[]> {
		return (await deps.targets.of(personId)).filter(
			(target) => settings.screens[target.kind] && deps.push[target.kind],
		);
	}

	/** Sends to each target. Returns the ids that got it. Forgets a target its service lost. */
	async function sendTo(
		targets: readonly PushTarget[],
		msg: NotificationMessage,
	): Promise<string[]> {
		const sent: string[] = [];
		for (const target of targets) {
			const channel = deps.push[target.kind];
			if (!channel) continue;
			try {
				const result = await channel.send(target, msg);
				if (result === "gone") await deps.targets.forget(target.id);
				else sent.push(target.id);
			} catch (error) {
				onError(`A ${target.kind} push did not go out.`, error);
			}
		}
		return sent;
	}

	/**
	 * Tells every screen of the Space's audience about one event. `inApp`
	 * false: pushes only, for a Gate found open at start (the open pages
	 * read everything again when they connect).
	 */
	async function tell(
		kind: NoticeKind,
		key: string,
		ids: { spaceId: string; runId: string; stepId: string | null },
		inApp = true,
	): Promise<void> {
		const sends = await deps.sendsFor(ids.spaceId);
		for (const personId of await deps.audience(ids.spaceId)) {
			const settings = await deps.settings.get(personId);
			const wanted = wants(settings, kind);
			// Quiet hours hold the alert of an open page too: it only updates.
			const alert = inApp && sends && wanted && !inQuietHours(settings, now());
			if (inApp) {
				await deps.inApp.send(
					{ kind: "in-app", personId },
					message(kind, key, ids, alert),
				);
			}
			if (wanted) {
				await push(
					{ personId, key, kind, ...ids },
					settings,
					{
						...(await pushMessage(kind, key, ids, personId)),
						toldInApp: alert,
					},
					sends,
				);
			}
		}
	}

	/**
	 * Pushes one event to one Person, or holds it: once per key. `sends`:
	 * this daemon sends the Space's pushes. Else only this computer's own
	 * screens get it.
	 */
	async function push(
		claim: Claim,
		settings: NotificationSettings,
		msg: NotificationMessage,
		sends: boolean,
	): Promise<void> {
		const at = now();
		const targets = (await pushTargets(claim.personId, settings)).filter(
			(target) => sends || LOCAL_KINDS.has(target.kind),
		);
		if (targets.length === 0) {
			if (sends) await deps.deliveries.claim(claim, { status: "dropped" }, at);
			return;
		}
		if (inQuietHours(settings, at)) {
			await deps.deliveries.claim(
				claim,
				{ status: "quiet", heldFor: targets.map((t) => t.id) },
				at,
			);
			return;
		}
		const holding =
			settings.holdMinutes > 0 && deps.inApp.isActive(claim.personId);
		const held = holding ? targets.filter((t) => t.kind !== "desktop") : [];
		const immediate = targets.filter((t) => !held.includes(t));
		const claimed = await deps.deliveries.claim(
			claim,
			held.length > 0
				? {
						status: "held",
						dueAt: at + settings.holdMinutes * 60_000,
						heldFor: held.map((t) => t.id),
					}
				: { status: "sent" },
			at,
		);
		if (!claimed) return;
		const sentTo = await sendTo(immediate, msg);
		await deps.deliveries.update(claim.personId, claim.key, {
			sentTo,
			sentAt: sentTo.length > 0 ? at : null,
			...(held.length > 0
				? {}
				: { status: sentTo.length > 0 ? "sent" : "dropped" }),
		});
	}

	/** A Gate closed: withdraw it everywhere, and drop what still waits. */
	async function close(spaceId: string, key: string): Promise<void> {
		for (const personId of await deps.audience(spaceId)) {
			await deps.inApp.withdraw({ kind: "in-app", personId }, key);
		}
		for (const row of await deps.deliveries.live(key)) {
			for (const target of await deps.targets.byIds(row.sentTo)) {
				try {
					await deps.push[target.kind]?.withdraw(target, key);
				} catch (error) {
					onError(`A ${target.kind} withdraw did not go out.`, error);
				}
			}
			await deps.deliveries.update(row.personId, key, {
				status: row.sentTo.length > 0 ? "withdrawn" : "dropped",
				heldFor: [],
				withdrawnAt: now(),
			});
		}
	}

	async function handle(events: readonly RunEvent[]): Promise<void> {
		const bySpace = new Map<string, RunEvent[]>();
		for (const event of events) {
			const list = bySpace.get(event.spaceId) ?? [];
			list.push(event);
			bySpace.set(event.spaceId, list);
		}
		for (const [spaceId, list] of bySpace) {
			/** The runs of this landing an item already tells of: a screen reads them again. */
			const told = new Set<string>();
			const { opened, closed } = await gates.apply(spaceId, list);
			for (const key of closed) {
				await close(spaceId, key);
				const gate = parseGateKey(key);
				if (gate) told.add(gate.runId);
			}
			for (const { key, runId, stepId } of opened) {
				await tell("gate-opened", key, { spaceId, runId, stepId });
				told.add(runId);
			}
			for (const event of list) {
				if (event.type !== "RunEnded") continue;
				const status = (event.payload as { status?: string }).status;
				if (status !== "finished" && status !== "failed") continue;
				await tell(
					status === "finished" ? "run-finished" : "run-failed",
					runEndKey(event.runId, event.seq),
					{ spaceId, runId: event.runId, stepId: null },
				);
				told.add(event.runId);
			}
			await runsChanged(spaceId, list, told);
		}
	}

	/** Tells the open screens of the Space's audience, once per run, that a run changed. */
	async function runsChanged(
		spaceId: string,
		events: readonly RunEvent[],
		told: ReadonlySet<string>,
	): Promise<void> {
		const runs = new Set(
			events
				.filter((e) => RUN_CHANGES.has(e.type) && !told.has(e.runId))
				.map((e) => e.runId),
		);
		if (runs.size === 0) return;
		const audience = await deps.audience(spaceId);
		for (const runId of runs) {
			for (const personId of audience) {
				deps.inApp.runChanged({ kind: "in-app", personId }, { spaceId, runId });
			}
		}
	}

	/** The message of a held entry, as it went out the first time. */
	function messageOf(row: Delivery): Promise<NotificationMessage> {
		return pushMessage(
			row.kind,
			row.key,
			{ spaceId: row.spaceId, runId: row.runId, stepId: row.stepId },
			row.personId,
		);
	}

	/**
	 * Sends the held pushes that are due: their time came, or their Person
	 * has no screen open anymore (the phone app went to the background, the
	 * last page closed a minute ago).
	 */
	async function sendDue(at: number): Promise<void> {
		const held = await deps.deliveries.held();
		const due = held.filter(
			(row) =>
				(row.dueAt !== null && row.dueAt <= at) ||
				!deps.inApp.isActive(row.personId),
		);
		for (const row of due) {
			const settings = await deps.settings.get(row.personId);
			if (inQuietHours(settings, at)) {
				await deps.deliveries.update(row.personId, row.key, {
					status: "quiet",
				});
				continue;
			}
			// A run's end showed on the open screen: no push after it.
			const seen =
				row.kind !== "gate-opened" && deps.inApp.isActive(row.personId);
			const sent = seen
				? []
				: await sendTo(
						await deps.targets.byIds(row.heldFor),
						await messageOf(row),
					);
			const sentTo = [...row.sentTo, ...sent];
			await deps.deliveries.update(row.personId, row.key, {
				status: sentTo.length > 0 ? "sent" : "dropped",
				sentTo,
				heldFor: [],
				sentAt: sent.length > 0 ? at : row.sentAt,
			});
		}
	}

	async function endQuietHours(at: number): Promise<void> {
		const byPerson = new Map<string, Delivery[]>();
		for (const row of await deps.deliveries.quiet()) {
			const list = byPerson.get(row.personId) ?? [];
			list.push(row);
			byPerson.set(row.personId, list);
		}
		for (const [personId, rows] of byPerson) {
			const settings = await deps.settings.get(personId);
			if (inQuietHours(settings, at)) continue;
			const gates = rows.filter((row) => row.kind === "gate-opened");
			// Runs that ended meanwhile go without a push.
			for (const row of rows) {
				if (row.kind === "gate-opened") continue;
				await deps.deliveries.update(personId, row.key, {
					status: "dropped",
					heldFor: [],
				});
			}
			// Each screen hears of the Gates it held, and only of those: a
			// Space another Host sends for held this computer's own screens.
			const held = [...new Set(gates.flatMap((row) => row.heldFor))];
			const targets = (await deps.targets.byIds(held)).filter(
				(target) => settings.screens[target.kind],
			);
			const sentTo = new Map<string, string[]>();
			for (const target of targets) {
				const waiting = gates.filter((row) => row.heldFor.includes(target.id));
				const [one] = waiting;
				if (waiting.length === 1 && one) {
					// One Gate: the Gate itself, so its answer withdraws it.
					const sent = await sendTo([target], await messageOf(one));
					sentTo.set(one.key, [...(sentTo.get(one.key) ?? []), ...sent]);
				} else if (waiting.length > 1) {
					await sendTo([target], {
						key: waitingKey(at),
						kind: "gates-waiting",
						spaceId: null,
						runId: null,
						stepId: null,
						title: gatesWaitingTitle(waiting.length),
						alert: true,
						count: waiting.length,
						at,
					});
				}
			}
			for (const row of gates) {
				const sent = sentTo.get(row.key) ?? [];
				await deps.deliveries.update(personId, row.key, {
					status: sent.length > 0 ? "sent" : "dropped",
					sentTo: sent,
					heldFor: [],
					sentAt: sent.length > 0 ? at : null,
				});
			}
		}
	}

	async function baseline(): Promise<void> {
		await gates.baseline(await deps.spaces());
		// Gates that closed while this daemon was away: withdraw them now.
		const closed = new Map<string, string>();
		for (const row of await deps.deliveries.liveGates()) {
			if (!gates.isOpen(row.spaceId, row.key)) closed.set(row.key, row.spaceId);
		}
		for (const [key, spaceId] of closed) await close(spaceId, key);
		// Gates that opened while no notifier listened (a reload, a start, a
		// run that woke): pushed now. The log drops the ones already told.
		for (const { spaceId, key, runId, stepId } of gates.open()) {
			await tell("gate-opened", key, { spaceId, runId, stepId }, false);
		}
	}

	return {
		start() {
			stopped = false;
			const ready = enqueue("The open Gates were not read.", baseline);
			unsubscribe = deps.events.subscribe((events) => {
				if (stopped) return;
				void enqueue("A run event was not handled.", () => handle(events));
			});
			timer = setInterval(() => {
				if (!stopped) void enqueue("Held pushes were not sent.", tick);
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
		tick: () => enqueue("Held pushes were not sent.", tick),
		idle: () => queue,
	};

	async function tick(): Promise<void> {
		const at = now();
		await sendDue(at);
		await endQuietHours(at);
	}
}
