import {
	INBOX_KEEP_MS,
	type LandedFact,
	type ScheduleMissed,
} from "@nightshift/engine";
import type { GateUrgency } from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";
import type { NotificationMessage, PushTarget } from "../channels";
import {
	needsALookKey,
	parseGateKey,
	scheduleMissedKey,
	waitingKey,
} from "../contract";
import type { Claim, Delivery, NoticeKind } from "../deliveries";
import {
	inQuietHours,
	type NotificationSettings,
	pushesUrgency,
} from "../settings";
import { changedRuns, endedRuns, factsBySpace } from "./domain/facts";
import { createGateTracker } from "./domain/gate-tracker";
import {
	claimOf,
	type GateFacts,
	gateFactsOf,
	gatesWaitingMessage,
	keptWords,
	type NoticeIds,
	noticeMessage,
} from "./domain/message";
import {
	createBundles,
	createPruneClock,
	createSerialQueue,
	DEFAULT_TICK_MS,
} from "./domain/notifier-state";
import {
	byPerson,
	duePushes,
	heldTargetIds,
	heldTargets,
	pushedEntry,
	quietEnd,
	quietEndEntry,
	reachable,
	seenOnScreen,
	sendingClaim,
	sentHeldEntry,
	wants,
	withdrawnEntry,
} from "./domain/pushes";
import { createWaitTracker, type StartedWait } from "./domain/wait-tracker";
import {
	deviceWaitWords,
	type NoticeWords,
	needsALookWords,
	scheduleMissedWords,
} from "./domain/words";
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
 * This file reads and sends through `NotifierDeps`.
 */

export function createNotifier(deps: NotifierDeps): Notifier {
	const now = deps.now ?? timeNow;
	const onError =
		deps.onError ??
		((message: string, error: unknown) =>
			console.error(`[notifications] ${message}`, error));
	/** The open Gates this notifier knows, and what the engine said of each. */
	const gates = createGateTracker((spaceId) => deps.events.openGates(spaceId));
	/** The steps that wait for an offline Device. */
	const waits = createWaitTracker();
	const mayAnswer = deps.mayAnswer ?? (async () => false);
	const bundles = createBundles();
	const queue = createSerialQueue(onError);
	const enqueue = queue.enqueue;
	const pruning = createPruneClock();
	let stopped = false;
	let unsubscribe: (() => void) | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;

	/** What a push about the Gate may show the Person: `mayAnswer` is asked only for a Gate marked for the lock screen. */
	async function gateFacts(
		key: string,
		spaceId: string,
		personId: string,
	): Promise<GateFacts> {
		const ref = gates.factsOf(spaceId, key);
		return gateFactsOf(
			ref,
			ref?.lockScreen === true && (await mayAnswer(spaceId, personId)),
		);
	}

	/** The message a push sends: a Gate's adds what its notification may show. */
	async function pushMessage(
		kind: NoticeKind,
		key: string,
		ids: NoticeIds,
		personId: string,
		words?: NoticeWords,
	): Promise<NotificationMessage> {
		const msg = noticeMessage(kind, key, ids, true, now(), words);
		if (kind !== "gate-opened") return msg;
		return { ...msg, gate: await gateFacts(key, ids.spaceId, personId) };
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
	 * Tells every screen of the people about one event: the Space's
	 * audience, unless `people` names some of them. `inApp` false: pushes
	 * only, for a Gate found open at start (the open pages read everything
	 * again when they connect). `words`: what it says to each Person, when
	 * it says more than the sentence of its kind.
	 */
	async function tell(
		kind: NoticeKind,
		key: string,
		ids: NoticeIds,
		options: {
			inApp?: boolean;
			people?: readonly string[];
			words?: (settings: NotificationSettings) => NoticeWords;
			/** A Gate's urgency: only the urgencies the Person chose push. */
			urgency?: GateUrgency;
		} = {},
	): Promise<void> {
		const inApp = options.inApp ?? true;
		const sends = await deps.sendsFor(ids.spaceId);
		for (const personId of options.people ??
			(await deps.audience(ids.spaceId))) {
			const settings = await deps.settings.get(personId);
			const wanted = wants(settings, kind);
			const words = options.words?.(settings);
			// Quiet hours hold the alert of an open page too: it only updates.
			const alert = inApp && sends && wanted && !inQuietHours(settings, now());
			if (inApp) {
				await deps.inApp.send(
					{ kind: "in-app", personId },
					noticeMessage(kind, key, ids, alert, now(), words),
				);
			}
			// A Gate of an urgency the Person does not push for: the inbox only.
			const pushes =
				wanted &&
				(options.urgency === undefined ||
					pushesUrgency(settings, options.urgency));
			if (pushes) {
				await push(
					claimOf(personId, key, kind, ids, words),
					settings,
					{
						...(await pushMessage(kind, key, ids, personId, words)),
						toldInApp: alert,
					},
					sends,
				);
			}
		}
	}

	/**
	 * A step waits for an offline Device: the Person the run runs for hears
	 * of it, if they are still a Member of the Space. Nobody else does.
	 */
	async function tellWait(spaceId: string, wait: StartedWait): Promise<void> {
		const run = await deps.events.run(spaceId, wait.runId);
		const personId = run?.personId;
		if (!run || !personId) return;
		if (!(await deps.audience(spaceId)).includes(personId)) return;
		await tell(
			"device-wait",
			wait.key,
			{ spaceId, runId: wait.runId, stepId: wait.stepId },
			{
				people: [personId],
				words: (settings) =>
					deviceWaitWords({
						flow: run.title,
						device: wait.deviceName,
						stopAt: run.stopAt,
						timeZone: settings.timeZone,
						now: now(),
					}),
			},
		);
	}

	/**
	 * A schedule's cron time was missed by more than it allows: every
	 * Member of the Space hears "A schedule did not start", with the flow
	 * and the time on their own clock. A push only: no open page has an
	 * item for it, so it goes when the person closes their pages.
	 */
	async function tellMissed(missed: ScheduleMissed): Promise<void> {
		await tell(
			"schedule-missed",
			scheduleMissedKey(missed),
			{ spaceId: missed.spaceId, runId: "", stepId: null },
			{
				inApp: false,
				words: (settings) =>
					scheduleMissedWords({
						flow: missed.flow,
						at: missed.at,
						timeZone: settings.timeZone,
						now: now(),
					}),
			},
		);
	}

	/**
	 * A run's end turned its flow severe under Needs a look: every Member
	 * of the Space hears "<flow>", "Needs a look. Failed 2 runs in a row."
	 * A push only, of the Now urgency.
	 */
	async function tellSevere(spaceId: string, runId: string): Promise<void> {
		const turn = await deps.events.severeTurn?.(spaceId, runId);
		if (!turn) return;
		const run = await deps.events.run(spaceId, runId);
		await tell(
			"flow-needs-a-look",
			needsALookKey(turn),
			{ spaceId, runId, stepId: null },
			{
				inApp: false,
				urgency: "now",
				words: () =>
					needsALookWords({
						flow: run?.title ?? turn.flow,
						signal: turn.signal,
					}),
			},
		);
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
		const targets = reachable(
			await pushTargets(claim.personId, settings),
			sends,
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
		const held = heldTargets(targets, holding);
		const immediate = targets.filter((t) => !held.includes(t));
		const ids = targets.map((t) => t.id);
		const holdMinutes = settings.holdMinutes;
		// Every target until the push went out (`sendDue` checks them).
		const sending = sendingClaim(ids, held.length > 0, at, holdMinutes);
		if (!(await deps.deliveries.claim(claim, sending, at))) return;
		const sentTo = await sendTo(immediate, msg);
		const heldIds = held.map((t) => t.id);
		const entry = pushedEntry(sentTo, heldIds, at);
		await deps.deliveries.update(claim.personId, claim.key, entry);
	}

	/** A Gate closed, or a device wait is over: withdraw it everywhere, and drop what still waits. */
	async function close(spaceId: string, key: string): Promise<void> {
		for (const personId of await deps.audience(spaceId)) {
			await deps.inApp.withdraw({ kind: "in-app", personId }, key);
		}
		for (const row of await deps.deliveries.live(key)) {
			await withdrawFrom(row.sentTo, key);
			const entry = withdrawnEntry(row, now());
			await deps.deliveries.update(row.personId, key, entry);
		}
		// Each "N Gates wait for you" push whose last Gate just closed.
		for (const bundle of bundles.closed(key)) {
			await withdrawFrom([bundle.targetId], bundle.key);
		}
	}

	/** Takes the push of the key back from each target of the ids. */
	async function withdrawFrom(ids: string[], key: string): Promise<void> {
		for (const target of await deps.targets.byIds(ids)) {
			try {
				await deps.push[target.kind]?.withdraw(target, key);
			} catch (error) {
				onError(`A ${target.kind} withdraw did not go out.`, error);
			}
		}
	}

	async function handle(facts: readonly LandedFact[]): Promise<void> {
		for (const [spaceId, list] of factsBySpace(facts)) {
			/** The runs of this landing an item already tells of: a screen reads them again. */
			const told = new Set<string>();
			const { opened, closed } = await gates.apply(spaceId, list);
			for (const key of closed) {
				await close(spaceId, key);
				const gate = parseGateKey(key);
				if (gate) told.add(gate.runId);
			}
			for (const { key, runId, stepId, urgency } of opened) {
				await tell("gate-opened", key, { spaceId, runId, stepId }, { urgency });
				told.add(runId);
			}
			// The other Members' screens hear of the wait as a run that changed.
			const { started, ended } = waits.apply(spaceId, list, now());
			for (const key of ended) await close(spaceId, key);
			for (const wait of started) await tellWait(spaceId, wait);
			for (const end of endedRuns(list)) {
				await tell(end.kind, end.key, {
					spaceId,
					runId: end.runId,
					stepId: null,
				});
				told.add(end.runId);
			}
			for (const fact of list) {
				if (fact.kind === "run-ended") await tellSevere(spaceId, fact.runId);
			}
			await runsChanged(spaceId, list, told);
		}
	}

	/**
	 * Tells the open screens of the Space's audience, once per run, that
	 * what a list of runs shows of it changed. A Gate has an item of its
	 * own. A spend so far, or what only the run's page shows, does not count.
	 */
	async function runsChanged(
		spaceId: string,
		facts: readonly LandedFact[],
		told: ReadonlySet<string>,
	): Promise<void> {
		const runs = changedRuns(facts, told);
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
			keptWords(row),
		);
	}

	/**
	 * Sends the held pushes that are due: their time came, or their Person
	 * has no screen open anymore (the phone app went to the background, the
	 * last page closed a minute ago). A push a crash cut short is due too.
	 */
	async function sendDue(at: number): Promise<void> {
		const held = await deps.deliveries.held();
		const sending = await deps.deliveries.sending();
		const due = duePushes(held, sending, at, (personId) =>
			deps.inApp.isActive(personId),
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
			const seen = seenOnScreen(row.kind, () =>
				deps.inApp.isActive(row.personId),
			);
			const sent = seen
				? []
				: await sendTo(
						await deps.targets.byIds(row.heldFor),
						await messageOf(row),
					);
			await deps.deliveries.update(
				row.personId,
				row.key,
				sentHeldEntry(row, sent, at),
			);
		}
	}

	async function endQuietHours(at: number): Promise<void> {
		for (const [personId, rows] of byPerson(await deps.deliveries.quiet())) {
			const settings = await deps.settings.get(personId);
			if (inQuietHours(settings, at)) continue;
			const { gates, stillWait, dropped } = quietEnd(rows);
			// Runs that ended meanwhile go without a push.
			for (const row of dropped) {
				await deps.deliveries.update(personId, row.key, {
					status: "dropped",
					heldFor: [],
				});
			}
			// Each screen hears of the Gates it held, and only of those: a
			// Space another Host sends for held this computer's own screens.
			const targets = (await deps.targets.byIds(heldTargetIds(gates))).filter(
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
					const key = waitingKey(at);
					// The screen was told of each Gate: each one's close withdraws it there.
					const sent = await sendTo(
						[target],
						gatesWaitingMessage(key, waiting.length, at),
					);
					for (const row of waiting) {
						sentTo.set(row.key, [...(sentTo.get(row.key) ?? []), ...sent]);
					}
					if (sent.length > 0) {
						bundles.add({
							targetId: target.id,
							key,
							gates: new Set(waiting.map((row) => row.key)),
						});
					}
				}
			}
			for (const row of stillWait) {
				const reach = (await deps.targets.byIds(row.heldFor)).filter(
					(target) => settings.screens[target.kind],
				);
				sentTo.set(row.key, await sendTo(reach, await messageOf(row)));
			}
			for (const row of [...gates, ...stillWait]) {
				const sent = sentTo.get(row.key) ?? [];
				await deps.deliveries.update(
					personId,
					row.key,
					quietEndEntry(sent, at),
				);
			}
		}
	}

	async function baseline(): Promise<void> {
		await gates.baseline(await deps.spaces());
		// Gates that closed while this daemon was away: withdraw them now.
		const closed = new Map<string, string>();
		for (const row of await deps.deliveries.liveOfKind("gate-opened")) {
			if (!gates.isOpen(row.spaceId, row.key)) closed.set(row.key, row.spaceId);
		}
		for (const [key, spaceId] of closed) await close(spaceId, key);
		// Gates that opened while no notifier listened (a reload, a start, a
		// run that woke): pushed now. The log drops the ones already told.
		for (const { spaceId, key, runId, stepId } of gates.open()) {
			await tell(
				"gate-opened",
				key,
				{ spaceId, runId, stepId },
				{ inApp: false },
			);
		}
		// Device waits the log told: over when their run no longer sleeps.
		const told = new Map<string, Delivery>();
		for (const row of await deps.deliveries.liveOfKind("device-wait")) {
			told.set(row.key, row);
		}
		for (const [key, row] of told) {
			const run = await deps.events.run(row.spaceId, row.runId);
			if (run?.sleeping) waits.track(row.spaceId, key);
			else await close(row.spaceId, key);
		}
	}

	/** The device waits whose step did not sleep again: withdraw them. */
	async function endWaits(at: number): Promise<void> {
		for (const { spaceId, key } of waits.due(at)) await close(spaceId, key);
	}

	return {
		start() {
			stopped = false;
			const ready = enqueue("The open Gates were not read.", baseline);
			const offFacts = deps.events.subscribe((facts) => {
				if (stopped) return;
				void enqueue("A run event was not handled.", () => handle(facts));
			});
			const offMissed = deps.events.onScheduleMissed?.((missed) => {
				if (stopped) return;
				void enqueue("A missed schedule was not told.", () =>
					tellMissed(missed),
				);
			});
			unsubscribe = () => {
				offFacts();
				offMissed?.();
			};
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
		commandsChanged: (spaceId, runId) =>
			stopped
				? Promise.resolve()
				: enqueue("The Gates of a run were not read again.", async () => {
						const { closed } = await gates.recheck(spaceId, runId);
						for (const key of closed) await close(spaceId, key);
					}),
		idle: () => queue.idle(),
	};

	async function tick(): Promise<void> {
		const at = now();
		await endWaits(at);
		await sendDue(at);
		await endQuietHours(at);
		await prune(at);
	}

	/** Removes the entries older than the inbox keeps (90 days), once an hour. */
	async function prune(at: number): Promise<void> {
		if (!pruning.due(at)) return;
		await deps.deliveries.prune(at - INBOX_KEEP_MS);
	}
}
