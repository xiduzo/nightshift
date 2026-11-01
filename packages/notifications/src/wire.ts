import {
	endSession,
	roleAllows,
	roleIn,
	spaceIds,
	spacesOf,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { now as timeNow } from "@nightshift/time";
import {
	createVapidKeyStore,
	createWebPushChannel,
	type InAppChannel,
	type InAppItem,
	type PushChannels,
	type VapidKeys,
	type WatchOptions,
	type WebPushSender,
} from "./channels";
import { createDeliveryLog } from "./deliveries";
import {
	type Digest,
	type DigestSource,
	digestFrom,
	readDigest,
} from "./digest";
import { createNotifier, type RunEventSource, spaceAudience } from "./notifier";
import {
	type ComputerSwitches,
	createSettingsStore,
	digestTime,
	eventsOfSwitches,
	type NotificationSettings,
	type NotificationSettingsPatch,
} from "./settings";
import {
	createTargetStore,
	type PushTargetView,
	type RegisterTarget,
	targetView,
} from "./targets";

/**
 * The notifications of one daemon, wired: the stores on the database, the
 * notifier on the run events, and what the API's procedures call. The
 * daemon makes one per engine and keeps the in-app channel across
 * `bun --hot` reloads, so an open stream outlives a reload.
 */

export type NotificationsOptions = {
	db: Database;
	events: RunEventSource;
	/** Whether this daemon sends the pushes of the Space (`oneSenderPerSpace`). */
	sendsFor(spaceId: string): Promise<boolean>;
	inApp: InAppChannel;
	/** The push channels this daemon has. Default: none, the in-app stream only. `stop` stops them too. */
	push?: PushChannels;
	/** The runs and Gates the morning digest reads. Absent: no digest. */
	digests?: DigestSource;
	/**
	 * Web Push from this daemon, with the VAPID keys it keeps (made once).
	 * `subject`: an `https:` URL or a `mailto:` address that push services
	 * may contact. Without it, browsers get no pushes from this daemon.
	 */
	webPush?: {
		subject: string;
		sender?: WebPushSender;
		/** Makes a new VAPID key pair. Default: `web-push`'s. */
		generateKeys?: () => VapidKeys;
	};
	now?: () => number;
	tickMs?: number;
	/** The time zone of a Person without settings. Default: this computer's. */
	timeZone?: string;
};

export type Notifications = {
	/**
	 * The Person's in-app stream: every event of every Space they are in,
	 * until `signal` aborts. `here`: the screen is on this computer.
	 * `phone`: the phone app, which counts as closed once it leaves the front.
	 */
	watch(
		personId: string,
		signal: AbortSignal,
		options?: WatchOptions,
	): AsyncGenerator<InAppItem>;
	settings: {
		get(personId: string): Promise<NotificationSettings>;
		save(
			personId: string,
			patch: NotificationSettingsPatch,
		): Promise<NotificationSettings>;
		/** The one-time copy of the switches a computer kept, for a Person without settings. */
		seed(personId: string, switches: ComputerSwitches): Promise<void>;
		/**
		 * After a save of the computer's settings: when it changed one of
		 * the three switches, the Person's events take their values.
		 */
		adoptComputerSwitches(
			personId: string,
			patch: Partial<Record<keyof ComputerSwitches, unknown>>,
			switches: ComputerSwitches,
		): Promise<void>;
	};
	targets: {
		list(personId: string): Promise<PushTargetView[]>;
		register(
			personId: string,
			input: RegisterTarget,
			sessionId?: string | null,
		): Promise<PushTargetView>;
		/**
		 * Removes one of the Person's screens. A phone is also signed out:
		 * its session ends. Null when the Person has no target of that id.
		 */
		remove(personId: string, id: string): Promise<PushTargetView | null>;
	};
	webPush: {
		/** The public VAPID key a browser subscribes with. Null: this daemon sends no Web Push. */
		publicKey(): Promise<string | null>;
	};
	digest: {
		/**
		 * The Person's last digest, read again now: the runs that ended
		 * between the digest before it and it, and the Gates that wait now,
		 * in every Space the Person is in. Null: no digest went out yet.
		 */
		latest(personId: string): Promise<Digest | null>;
		/**
		 * A digest read now: the runs that ended after `from` (default: at
		 * the last digest the Person got, or a day back, a week at most) and the Gates that wait
		 * now, in every Space the Person is in. Null: no run ended and no
		 * Gate waits.
		 */
		since(personId: string, from?: number): Promise<Digest | null>;
	};
	/**
	 * Tells the open screens of every Member of the Space that a project's
	 * schedules changed without a run (a pause tonight). Quiet: no push.
	 */
	schedulesChanged(spaceId: string, projectId: string): Promise<void>;
	/**
	 * Tells the open screens of the Space's Members that the learnings of
	 * a project changed: a person kept or deleted some. Quiet: no push.
	 */
	learningsChanged(spaceId: string, projectId: string): Promise<void>;
	/** Reads the open Gates, then listens to the run events. */
	start(): Promise<void>;
	stop(): void;
};

export function createNotifications(
	options: NotificationsOptions,
): Notifications {
	const { db } = options;
	const now = options.now ?? timeNow;
	const settings = createSettingsStore(db, {
		...(options.timeZone ? { timeZone: options.timeZone } : {}),
	});
	const targets = createTargetStore(db, now);
	const vapid = options.webPush
		? createVapidKeyStore(db, options.webPush.generateKeys)
		: null;
	const push: PushChannels = { ...options.push };
	if (options.webPush && vapid) {
		push.web = createWebPushChannel({
			keys: vapid,
			subject: options.webPush.subject,
			...(options.webPush.sender ? { sender: options.webPush.sender } : {}),
		});
	}
	const deliveries = createDeliveryLog(db);
	const audience = spaceAudience(db);
	const notifier = createNotifier({
		events: options.events,
		audience,
		spaces: () => spaceIds(db),
		sendsFor: options.sendsFor,
		mayAnswer: async (spaceId, personId) => {
			const role = await roleIn(db, personId, spaceId);
			return role !== null && roleAllows(role, { gate: ["resolve"] });
		},
		settings,
		targets,
		deliveries,
		inApp: options.inApp,
		push,
		...(options.digests ? { digests: options.digests } : {}),
		now,
		...(options.tickMs ? { tickMs: options.tickMs } : {}),
	});
	return {
		watch: (personId, signal, watch) =>
			options.inApp.watch(personId, signal, watch),
		settings: {
			get: (personId) => settings.get(personId),
			save: (personId, patch) => settings.save(personId, patch),
			seed: (personId, switches) =>
				settings.seed(personId, eventsOfSwitches(switches)),
			adoptComputerSwitches: (personId, patch, switches) =>
				settings.adoptComputerSwitches(personId, patch, switches),
		},
		targets: {
			list: async (personId) => (await targets.of(personId)).map(targetView),
			register: async (personId, input, sessionId = null) =>
				targetView(await targets.register(personId, input, sessionId)),
			remove: async (personId, id) => {
				const removed = await targets.remove(personId, id);
				if (!removed) return null;
				// A phone is a push target plus its session: removing it signs it out.
				if (removed.kind === "expo" && removed.sessionId) {
					await endSession(db, personId, removed.sessionId);
				}
				return targetView(removed);
			},
		},
		webPush: {
			publicKey: async () => (vapid ? (await vapid.get()).publicKey : null),
		},
		digest: {
			async latest(personId) {
				const source = options.digests;
				if (!source) return null;
				const rows = await deliveries.ofPerson(personId, "digest", 14);
				const index = rows.findIndex((row) => row.title !== null);
				const row = rows[index];
				if (!row) return null;
				const spaces = (await spacesOf(db, personId)).map((space) => space.id);
				return readDigest(source, spaces, {
					from: digestFrom(rows[index + 1]?.createdAt ?? null, row.createdAt),
					to: row.createdAt,
					time: digestTime(await settings.get(personId)),
				});
			},
			async since(personId, from) {
				const source = options.digests;
				if (!source) return null;
				const to = now();
				// The last digest the Person got: a row without a title said nothing.
				const last = (await deliveries.ofPerson(personId, "digest", 14)).find(
					(row) => row.title !== null,
				);
				const start = from ?? digestFrom(last?.createdAt ?? null, to);
				const spaces = (await spacesOf(db, personId)).map((space) => space.id);
				return readDigest(source, spaces, {
					from: start,
					to,
					time: digestTime(await settings.get(personId)),
				});
			},
		},
		async schedulesChanged(spaceId, projectId) {
			for (const personId of await audience(spaceId)) {
				options.inApp.schedulesChanged(
					{ kind: "in-app", personId },
					{ spaceId, projectId },
				);
			}
		},
		async learningsChanged(spaceId, projectId) {
			for (const personId of await audience(spaceId)) {
				options.inApp.learningsChanged(
					{ kind: "in-app", personId },
					{ spaceId, projectId },
				);
			}
		},
		start: () => notifier.start(),
		stop: () => {
			notifier.stop();
			for (const channel of Object.values(push)) channel.stop?.();
		},
	};
}
