import { endSession, roleAllows, roleIn, spaceIds } from "@nightshift/auth";
import type { Database } from "@nightshift/db";

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
import { createNotifier, type RunEventSource, spaceAudience } from "./notifier";
import {
	type ComputerSwitches,
	createSettingsStore,
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
	/** Reads the open Gates, then listens to the run events. */
	start(): Promise<void>;
	stop(): void;
};

export function createNotifications(
	options: NotificationsOptions,
): Notifications {
	const { db } = options;
	const now = options.now ?? Date.now;
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
	const notifier = createNotifier({
		events: options.events,
		audience: spaceAudience(db),
		spaces: () => spaceIds(db),
		sendsFor: options.sendsFor,
		mayAnswer: async (spaceId, personId) => {
			const role = await roleIn(db, personId, spaceId);
			return role !== null && roleAllows(role, { gate: ["resolve"] });
		},
		settings,
		targets,
		deliveries: createDeliveryLog(db),
		inApp: options.inApp,
		push,
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
		start: () => notifier.start(),
		stop: () => {
			notifier.stop();
			for (const channel of Object.values(push)) channel.stop?.();
		},
	};
}
