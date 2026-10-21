import { spaceIds } from "@nightshift/auth";
import type { Database } from "@nightshift/db";

import type { InAppChannel, InAppItem, PushChannels } from "./channels";
import { createDeliveryLog } from "./deliveries";
import { createNotifier, type RunEventSource, spaceAudience } from "./notifier";
import {
	createSettingsStore,
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
	/** The push channels this daemon has. Default: none, the in-app stream only. */
	push?: PushChannels;
	now?: () => number;
	tickMs?: number;
	/** The time zone of a Person without settings. Default: this computer's. */
	timeZone?: string;
};

export type Notifications = {
	/**
	 * The Person's in-app stream: every event of every Space they are in,
	 * until `signal` aborts. `here`: the screen is on this computer.
	 */
	watch(
		personId: string,
		signal: AbortSignal,
		options?: { here?: boolean },
	): AsyncGenerator<InAppItem>;
	settings: {
		get(personId: string): Promise<NotificationSettings>;
		save(
			personId: string,
			patch: NotificationSettingsPatch,
		): Promise<NotificationSettings>;
		/** The one-time copy of the choices a computer kept, for a Person without settings. */
		seed(
			personId: string,
			events: Partial<NotificationSettings["events"]>,
		): Promise<void>;
	};
	targets: {
		list(personId: string): Promise<PushTargetView[]>;
		register(
			personId: string,
			input: RegisterTarget,
			sessionId?: string | null,
		): Promise<PushTargetView>;
		/** Null when the Person has no target of that id. */
		remove(personId: string, id: string): Promise<PushTargetView | null>;
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
	const notifier = createNotifier({
		events: options.events,
		audience: spaceAudience(db),
		spaces: () => spaceIds(db),
		sendsFor: options.sendsFor,
		settings,
		targets,
		deliveries: createDeliveryLog(db),
		inApp: options.inApp,
		push: options.push ?? {},
		now,
		...(options.tickMs ? { tickMs: options.tickMs } : {}),
	});
	return {
		watch: (personId, signal, watch) =>
			options.inApp.watch(personId, signal, watch),
		settings: {
			get: (personId) => settings.get(personId),
			save: (personId, patch) => settings.save(personId, patch),
			seed: (personId, events) => settings.seed(personId, events),
		},
		targets: {
			list: async (personId) => (await targets.of(personId)).map(targetView),
			register: async (personId, input, sessionId = null) =>
				targetView(await targets.register(personId, input, sessionId)),
			remove: async (personId, id) => {
				const removed = await targets.remove(personId, id);
				return removed ? targetView(removed) : null;
			},
		},
		start: () => notifier.start(),
		stop: () => notifier.stop(),
	};
}
