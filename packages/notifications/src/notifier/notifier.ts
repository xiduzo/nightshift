import type { LandedFact } from "@nightshift/engine";
import { now as timeNow } from "@nightshift/time";
import {
	deviceWaitWords,
	type GateFacts,
	gatesWaitingTitle,
	type InAppChannel,
	type NoticeWords,
	type NotificationMessage,
	type PushChannels,
	titleOf,
} from "../channels";
import { digestKey, parseGateKey, runEndKey, waitingKey } from "../contract";
import type { Claim, Delivery, DeliveryLog, NoticeKind } from "../deliveries";
import {
	type Digest,
	type DigestSource,
	digestFrom,
	readDigest,
} from "../digest";
import {
	digestDay,
	digestTime,
	inQuietHours,
	type NotificationSettings,
	type SettingsStore,
} from "../settings";
import type { PushTarget, TargetStore } from "../targets";
import { createGateTracker } from "./gate-tracker";
import type { RunEventSource } from "./sources";
import { createWaitTracker, type StartedWait } from "./wait-tracker";

/**
 * The notifier: it reads the run events of this Replica and decides whom
 * to tell, about what, and on which screen. Four events: a new Gate
 * (keyed `runId:stepId`), a run that finished, a run that failed, and a
 * step that waits for an offline Device (keyed `runId:wait:<stepId>`).
 *
 * The rules:
 * - Who: the Members of the run's Space. A device wait goes only to the
 *   Person the run runs for: "<flow> waits for <device>", with the stop
 *   time. It is withdrawn when the wait is over (`wait-tracker.ts`).
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
 *   waits is dropped.
 * - Lock-screen answers: a push about a Gate its author marked carries its
 *   options, only to a person whose role allows an answer (`mayAnswer`).
 *
 * - The morning digest: once a day per Person, when their quiet hours
 *   end or at the time they chose (`digestDay`), one push sums up the
 *   runs that ended since the last digest and the Gates that wait. Its
 *   key is the day (`digest:<YYYY-MM-DD>`), so a restart never sends a
 *   day's digest twice. Nothing to say: no push. The push to a phone or a
 *   browser covers the Spaces this daemon sends for. This computer's
 *   desktop covers every Space it has, as for every other notice. It is
 *   not held while a screen is open: it is the morning's summary.
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
	/** The runs and Gates the morning digest reads. Absent: no digest. */
	digests?: DigestSource;
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

/** A push still `sending` this long after its claim was cut short by a crash. */
const LOST_AFTER_MS = 60_000;

/** How often the notifier looks for digests that are due. */
const DIGEST_CHECK_MS = 60_000;

/**
 * The screens of this computer itself: the desktop notification. The
 * daemon here shows them for every Space this Replica has, not only the
 * Spaces it sends for: a notification on this computer is no second
 * sender of a push. Its channel reaches no other computer.
 */
const LOCAL_KINDS: ReadonlySet<PushTarget["kind"]> = new Set(["desktop"]);

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
	let queue: Promise<void> = Promise.resolve();
	let stopped = false;
	let unsubscribe: (() => void) | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	/** The digests this notifier sent or skipped, as `personId digest:<day>`. */
	const digestsDone = new Set<string>();
	let digestCheckedAt = Number.NEGATIVE_INFINITY;

	function enqueue(what: string, job: () => Promise<void>): Promise<void> {
		queue = queue.then(job).catch((error) => onError(what, error));
		return queue;
	}

	function message(
		kind: NoticeKind,
		key: string,
		ids: { spaceId: string; runId: string; stepId: string | null },
		alert: boolean,
		words?: NoticeWords,
	): NotificationMessage {
		return {
			key,
			kind,
			...ids,
			title: words?.title ?? titleOf(kind),
			...(words?.body ? { body: words.body } : {}),
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
		words?: NoticeWords,
	): Promise<NotificationMessage> {
		const msg = message(kind, key, ids, true, words);
		if (kind !== "gate-opened") return msg;
		return { ...msg, gate: await gateFacts(key, ids.spaceId, personId) };
	}

	function wants(settings: NotificationSettings, kind: NoticeKind): boolean {
		if (kind === "gate-opened") return settings.events.gateOpened;
		if (kind === "run-finished") return settings.events.runFinished;
		if (kind === "device-wait") return settings.events.deviceWait;
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
	 * Tells every screen of the people about one event: the Space's
	 * audience, unless `people` names some of them. `inApp` false: pushes
	 * only, for a Gate found open at start (the open pages read everything
	 * again when they connect). `words`: what it says to each Person, when
	 * it says more than the sentence of its kind.
	 */
	async function tell(
		kind: NoticeKind,
		key: string,
		ids: { spaceId: string; runId: string; stepId: string | null },
		options: {
			inApp?: boolean;
			people?: readonly string[];
			words?: (settings: NotificationSettings) => NoticeWords;
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
					message(kind, key, ids, alert, words),
				);
			}
			if (wanted) {
				await push(
					{
						personId,
						key,
						kind,
						...ids,
						title: words?.title ?? null,
						body: words?.body ?? null,
					},
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
		// Every target until the push went out: a crash before then leaves
		// them all to the next check (`sendDue`).
		const claimed = await deps.deliveries.claim(
			claim,
			{
				status: "sending",
				heldFor: targets.map((t) => t.id),
				...(held.length > 0
					? { dueAt: at + settings.holdMinutes * 60_000 }
					: {}),
			},
			at,
		);
		if (!claimed) return;
		const sentTo = await sendTo(immediate, msg);
		await deps.deliveries.update(claim.personId, claim.key, {
			sentTo,
			sentAt: sentTo.length > 0 ? at : null,
			heldFor: held.map((t) => t.id),
			status: held.length > 0 ? "held" : sentTo.length > 0 ? "sent" : "dropped",
		});
	}

	/** A Gate closed, or a device wait is over: withdraw it everywhere, and drop what still waits. */
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

	async function handle(facts: readonly LandedFact[]): Promise<void> {
		const bySpace = new Map<string, LandedFact[]>();
		for (const fact of facts) {
			const list = bySpace.get(fact.spaceId) ?? [];
			list.push(fact);
			bySpace.set(fact.spaceId, list);
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
			// The other Members' screens hear of the wait as a run that changed.
			const { started, ended } = waits.apply(spaceId, list, now());
			for (const key of ended) await close(spaceId, key);
			for (const wait of started) await tellWait(spaceId, wait);
			for (const fact of list) {
				if (fact.kind !== "run-ended") continue;
				if (fact.status !== "finished" && fact.status !== "failed") continue;
				await tell(
					fact.status === "finished" ? "run-finished" : "run-failed",
					runEndKey(fact.runId, fact.seq),
					{ spaceId, runId: fact.runId, stepId: null },
				);
				told.add(fact.runId);
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
		const runs = new Set(
			facts
				.filter(
					(f) =>
						f.changes === "summary" &&
						f.kind !== "gate-opened" &&
						!told.has(f.runId),
				)
				.map((f) => f.runId),
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
		if (row.kind === "digest") {
			return Promise.resolve(
				digestMessage(row.key, {
					title: row.title ?? titleOf("digest"),
					body: row.body ?? "",
				}),
			);
		}
		return pushMessage(
			row.kind,
			row.key,
			{ spaceId: row.spaceId, runId: row.runId, stepId: row.stepId },
			row.personId,
			row.title === null
				? undefined
				: { title: row.title, ...(row.body ? { body: row.body } : {}) },
		);
	}

	/**
	 * Sends the held pushes that are due: their time came, or their Person
	 * has no screen open anymore (the phone app went to the background, the
	 * last page closed a minute ago). A push a crash cut short is due too.
	 */
	async function sendDue(at: number): Promise<void> {
		const held = await deps.deliveries.held();
		const lost = (await deps.deliveries.sending()).filter(
			(row) => row.createdAt + LOST_AFTER_MS <= at,
		);
		const due = [
			...held.filter(
				(row) =>
					(row.dueAt !== null && row.dueAt <= at) ||
					!deps.inApp.isActive(row.personId),
			),
			...lost,
		];
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
				row.kind !== "gate-opened" &&
				row.kind !== "digest" &&
				deps.inApp.isActive(row.personId);
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
			// A wait that is over was withdrawn: what is left still waits.
			const stillWait = rows.filter((row) => row.kind === "device-wait");
			// Runs that ended meanwhile go without a push.
			for (const row of rows) {
				if (row.kind === "gate-opened" || row.kind === "device-wait") continue;
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
			for (const row of stillWait) {
				const reach = (await deps.targets.byIds(row.heldFor)).filter(
					(target) => settings.screens[target.kind],
				);
				sentTo.set(row.key, await sendTo(reach, await messageOf(row)));
			}
			for (const row of [...gates, ...stillWait]) {
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

	/** The push of a digest. It spans Spaces: no Space, no run. */
	function digestMessage(
		key: string,
		words: Pick<Digest, "title" | "body">,
	): NotificationMessage {
		return {
			key,
			kind: "digest",
			spaceId: null,
			runId: null,
			stepId: null,
			title: words.title,
			...(words.body ? { body: words.body } : {}),
			alert: true,
			count: null,
			at: now(),
		};
	}

	/**
	 * Sends each Person the digest that is due: once a day, keyed by the
	 * day. The phones and browsers hear of the Spaces this daemon sends
	 * for, this computer's desktop of every Space it has. The entry keeps
	 * what the push said, also when nothing could take it, so the inbox can
	 * show the last digest. A day with nothing to say leaves an entry
	 * without words.
	 */
	async function sendDigests(at: number): Promise<void> {
		const source = deps.digests;
		if (!source || at - digestCheckedAt < DIGEST_CHECK_MS) return;
		digestCheckedAt = at;
		const spacesOf = new Map<string, string[]>();
		const sending = new Set<string>();
		for (const spaceId of await deps.spaces()) {
			if (await deps.sendsFor(spaceId)) sending.add(spaceId);
			for (const personId of await deps.audience(spaceId)) {
				spacesOf.set(personId, [...(spacesOf.get(personId) ?? []), spaceId]);
			}
		}
		for (const [personId, spaces] of spacesOf) {
			const settings = await deps.settings.get(personId);
			const day = digestDay(settings, at);
			if (day === null) continue;
			const key = digestKey(day);
			const done = `${personId} ${key}`;
			if (digestsDone.has(done)) continue;
			const [last] = await deps.deliveries.ofPerson(personId, "digest", 1);
			if (last?.key === key) {
				digestsDone.add(done);
				continue;
			}
			const window = {
				from: digestFrom(last?.createdAt ?? null, at),
				to: at,
				time: digestTime(settings),
			};
			const everywhere = await readDigest(source, spaces, window);
			const sent = spaces.filter((spaceId) => sending.has(spaceId));
			const sendsAll = sent.length === spaces.length;
			const remote =
				everywhere === null || sendsAll
					? everywhere
					: sent.length > 0
						? await readDigest(source, sent, window)
						: null;
			const words = remote ?? everywhere;
			const reach = (await pushTargets(personId, settings)).filter(
				(target) =>
					(LOCAL_KINDS.has(target.kind) ? everywhere : remote) !== null,
			);
			const claim: Claim = {
				personId,
				key,
				kind: "digest",
				spaceId: "",
				runId: "",
				stepId: null,
				title: words?.title ?? null,
				body: words?.body ?? null,
			};
			digestsDone.add(done);
			if (!words || reach.length === 0) {
				await deps.deliveries.claim(claim, { status: "dropped" }, at);
				continue;
			}
			const claimed = await deps.deliveries.claim(
				claim,
				{ status: "sending", heldFor: reach.map((t) => t.id) },
				at,
			);
			if (!claimed) continue;
			const sentTo: string[] = [];
			for (const target of reach) {
				const digest = LOCAL_KINDS.has(target.kind) ? everywhere : remote;
				if (!digest) continue;
				sentTo.push(...(await sendTo([target], digestMessage(key, digest))));
			}
			await deps.deliveries.update(personId, key, {
				status: sentTo.length > 0 ? "sent" : "dropped",
				sentTo,
				heldFor: [],
				sentAt: sentTo.length > 0 ? at : null,
			});
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
			unsubscribe = deps.events.subscribe((facts) => {
				if (stopped) return;
				void enqueue("A run event was not handled.", () => handle(facts));
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
		await endWaits(at);
		await sendDue(at);
		await endQuietHours(at);
		await sendDigests(at);
	}
}
