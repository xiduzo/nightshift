import type { Database } from "@nightshift/db";
import { deviceDirectory } from "@nightshift/devices";
import type { SettingsStore } from "@nightshift/engine";
import {
	createDesktopChannel,
	createExpoChannel,
	createInAppChannel,
	createNotifications,
	type DesktopNotifier,
	type DesktopWindow,
	engineRunEvents,
	type Notifications,
	oneSenderPerSpace,
	systemDesktopNotifier,
} from "@nightshift/notifications";

import { type DaemonEnv, hot, webPushSubject } from "../runtime";

/** This computer's desktop, as the app that runs the daemon shows it. */
export type DesktopScreen = {
	notifier: DesktopNotifier;
	/** The app's window, when the daemon runs inside the app. */
	window?: DesktopWindow;
};

export type NotificationsWiring = {
	db: Database;
	env: DaemonEnv;
	engine: Parameters<typeof engineRunEvents>[0];
	/** This computer's settings: whether it is a Host, and its old notification switches. */
	settings: SettingsStore;
	/** This computer's Device. */
	device: { id: string; name: string };
	/** The Person who owns this computer, and their personal Space. */
	owner: { userId: string; spaceId: string };
	/** How this computer shows its desktop notifications (`DaemonOptions.desktop`). */
	desktop: DesktopScreen | "system" | undefined;
};

/**
 * Whether this daemon sends the pushes of a Space (`oneSenderPerSpace`):
 * of the Spaces it keeps as a Host, else of its owner's personal Space
 * only. The notifier asks it, and so does a Space move about the Space
 * its runs go to.
 */
export function sendsPushesFor(
	db: Database,
	settings: SettingsStore,
	owner: { spaceId: string },
): (spaceId: string) => Promise<boolean> {
	const directory = deviceDirectory(db);
	return oneSenderPerSpace({
		isHost: () => settings.current().host,
		hostedElsewhere: (spaceId) => directory.hostedElsewhere(spaceId),
		ownPersonalSpaceId: async () => owner.spaceId,
	});
}

/**
 * The notifier of one daemon, started: it reads the run events and tells
 * each Member of a Space about a new Gate, a finished run and a failed
 * run, on every screen. It sends for the Spaces this computer keeps as a
 * Host, else for its owner's personal Space only. The in-app channel
 * outlives a `bun --hot` reload, so the open pages keep their stream. Web
 * Push signs with the VAPID keys this daemon makes once and keeps.
 *
 * Also returns this computer's settings as the API saves them: a save of
 * the three old notification switches also changes the owner's own
 * notification settings, for a client that still sends them.
 */
export async function wireNotifications(
	wiring: NotificationsWiring,
): Promise<{ notifications: Notifications; settings: SettingsStore }> {
	const { db, env, settings, device, owner } = wiring;
	hot.nightshiftInApp ??= createInAppChannel();
	hot.nightshiftNotifications?.stop();
	const inApp = hot.nightshiftInApp;
	const desktop = desktopScreen(wiring.desktop, env);
	const desktopChannel = desktop
		? createDesktopChannel({
				deviceId: device.id,
				ownerId: owner.userId,
				notifier: desktop.notifier,
				...(desktop.window ? { window: desktop.window } : {}),
				streamHere: (personId) => inApp.isActiveHere(personId),
			})
		: null;
	const notifications = createNotifications({
		db,
		events: engineRunEvents(wiring.engine),
		sendsFor: sendsPushesFor(db, settings, owner),
		inApp,
		webPush: { subject: webPushSubject(env) },
		push: {
			...(desktopChannel ? { desktop: desktopChannel } : {}),
			// The phone app registers with a Host, so only a Host has phones
			// to reach; `sendsFor` keeps every push to the Spaces this
			// computer sends for. EXPO_ACCESS_TOKEN is optional.
			expo: createExpoChannel({
				...(env.EXPO_ACCESS_TOKEN?.trim()
					? { accessToken: env.EXPO_ACCESS_TOKEN.trim() }
					: {}),
			}),
		},
	});
	hot.nightshiftNotifications = notifications;
	// Listens at once: the engine already recovers runs and wakes timers,
	// and an event that lands before the notifier listens is lost. Not
	// awaited: it reads every Space's open Gates first, and pushes the ones
	// that opened while no notifier listened.
	void notifications.start();
	// The switches this computer kept before notification settings moved
	// to the Person: its owner gets them once.
	await notifications.settings.seed(owner.userId, settings.current());
	// This computer's desktop is its owner's screen: registered at each
	// start, so it keeps the computer's name.
	if (desktopChannel) {
		await notifications.targets.register(owner.userId, {
			kind: "desktop",
			name: device.name,
			platform: process.platform,
			endpoint: device.id,
		});
	}
	return {
		notifications,
		settings: adoptingSwitches(settings, notifications, owner.userId),
	};
}

/**
 * This computer's settings, where a save also hands the three old
 * notification switches to the owner's notification settings. Only the
 * owner may save this computer's settings.
 */
export function adoptingSwitches(
	settings: SettingsStore,
	notifications: Pick<Notifications, "settings">,
	ownerId: string,
): SettingsStore {
	return {
		...settings,
		async save(patch) {
			const view = await settings.save(patch);
			await notifications.settings.adoptComputerSwitches(
				ownerId,
				patch,
				view.values,
			);
			return view;
		},
	};
}

/**
 * The desktop of this computer: the one the app passes, the OS programs
 * for "system", or none (also with NIGHTSHIFT_DESKTOP_NOTIFICATIONS=off,
 * and on a computer with no desktop).
 */
function desktopScreen(
	option: DesktopScreen | "system" | undefined,
	env: DaemonEnv,
): DesktopScreen | null {
	if (!option) return null;
	if (option !== "system") return option;
	if (env.NIGHTSHIFT_DESKTOP_NOTIFICATIONS?.trim().toLowerCase() === "off") {
		return null;
	}
	const notifier = systemDesktopNotifier({
		pageUrl: (path) => new URL(path, env.CORS_ORIGIN).toString(),
	});
	return notifier ? { notifier } : null;
}
