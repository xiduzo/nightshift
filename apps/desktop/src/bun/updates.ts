import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Updater, Utils } from "electrobun/main";

import { feedOf, UPDATE_FEEDS, type UpdateFeed } from "./update-feeds";

const APP_NAME = "Night Shift";
const FIRST_CHECK_AFTER_MS = 30_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export type Updates = {
	/** False in dev builds: they never update. */
	enabled: boolean;
	feed(): UpdateFeed;
	/** The version that is downloaded and waits for a restart, if any. */
	readyVersion(): string | null;
	setFeed(feed: UpdateFeed): void;
	/** Checks now and tells the person the result. */
	checkNow(): void;
	/** Asks, then restarts into the downloaded version. */
	restart(): Promise<void>;
};

type Options = {
	/** The menus show the feed and a ready update: rebuild them. */
	onChange(): void;
	/** Stops the daemon. The update quits the app without the usual before-quit. */
	beforeRestart(): Promise<void>;
};

function preferencesPath(): string {
	return join(Utils.paths.userData, "updates.json");
}

function savedFeed(): UpdateFeed | null {
	try {
		const { feed } = JSON.parse(readFileSync(preferencesPath(), "utf8"));
		return feed === "nightly" || feed === "stable" ? feed : null;
	} catch {
		return null;
	}
}

function saveFeed(feed: UpdateFeed): void {
	const path = preferencesPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ feed }, null, "\t")}\n`);
}

async function tell(message: string, detail = ""): Promise<void> {
	await Utils.showMessageBox({ title: APP_NAME, message, detail });
}

/**
 * Checks the chosen feed at start and every few hours, and downloads a new
 * version in the background. It never restarts on its own: runs in progress
 * would stop. The person restarts from the menu when it suits them.
 */
export async function startUpdates(options: Options): Promise<Updates> {
	const info = await Updater.getLocalInfo();
	const enabled = info.channel !== "dev" && info.baseUrl !== "";
	let feed = savedFeed() ?? feedOf(info.baseUrl);
	let ready: string | null = null;
	let checking = false;

	// Updater reads the feed from the bundled version.json once and keeps that
	// object. Point it at the feed the person chose.
	const useFeed = () => {
		info.baseUrl = UPDATE_FEEDS[feed];
	};

	async function check(manual: boolean): Promise<void> {
		if (!enabled || checking) return;
		checking = true;
		try {
			const found = await Updater.checkForUpdate();
			if (found.error) {
				console.error(found.error);
				if (manual) {
					await tell(
						`${APP_NAME} cannot check for updates.`,
						"Check your internet connection, then try again.",
					);
				}
				return;
			}
			if (!found.updateAvailable) {
				if (manual) await tell(`You have the latest version of ${APP_NAME}.`);
				return;
			}
			if (!found.updateReady) {
				if (manual) {
					Utils.showNotification({
						title: `${APP_NAME} ${found.version} is downloading`,
						body: "Night Shift asks you to restart when it is ready.",
						silent: true,
					});
				}
				await Updater.downloadUpdate();
			}
			const downloaded = Updater.updateInfo();
			if (!downloaded.updateReady) {
				console.error(downloaded.error);
				if (manual) {
					await tell(
						`${APP_NAME} cannot download the update.`,
						"Try again later.",
					);
				}
				return;
			}
			const isNew = ready !== downloaded.version;
			ready = downloaded.version;
			options.onChange();
			if (manual) {
				await updates.restart();
			} else if (isNew) {
				Utils.showNotification({
					title: `${APP_NAME} ${ready} is ready`,
					body: `Choose "Restart to Install" in the menu bar to update.`,
				});
			}
		} catch (error) {
			console.error("The update check failed.", error);
		} finally {
			checking = false;
		}
	}

	const updates: Updates = {
		enabled,
		feed: () => feed,
		readyVersion: () => ready,
		setFeed(next) {
			if (next === feed) return;
			feed = next;
			saveFeed(feed);
			useFeed();
			ready = null;
			options.onChange();
			void check(true);
		},
		checkNow() {
			void check(true);
		},
		async restart() {
			if (!ready) return;
			const { response } = await Utils.showMessageBox({
				type: "question",
				title: APP_NAME,
				message: `Restart to install ${APP_NAME} ${ready}?`,
				detail: "Runs in progress stop when Night Shift restarts.",
				buttons: ["Restart", "Later"],
				defaultId: 0,
				cancelId: 1,
			});
			if (response !== 0) return;
			await options.beforeRestart();
			await Updater.applyUpdate();
			// Still here: the update did not start, and the daemon is stopped.
			console.error(Updater.updateInfo().error);
			await tell(
				`${APP_NAME} cannot install the update.`,
				`Open ${APP_NAME} again to keep working. It tries the update again later.`,
			);
			Utils.quit();
		},
	};

	if (enabled) {
		useFeed();
		setTimeout(() => void check(false), FIRST_CHECK_AFTER_MS);
		setInterval(() => void check(false), CHECK_EVERY_MS);
	}
	return updates;
}
