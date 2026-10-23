import Electrobun, {
	ApplicationMenu,
	BrowserWindow,
	Tray,
	Updater,
	Utils,
} from "electrobun/main";

import {
	DAEMON_URL,
	type Daemon,
	PortTakenError,
	startDaemon,
} from "../features/daemon";
import { electrobunNotifier, trackWindow } from "../features/notifications";
import { startUpdates } from "../features/updates";

const APP_NAME = "Night Shift";
const WEB_DEV_SERVER_URL = "http://localhost:3001";
const PACKAGED_VIEW_URL = "views://mainview/index.html";

/** The dev channel loads the web dev server when it runs, for hot reload. */
async function mainViewUrl(): Promise<string> {
	if ((await Updater.localInfo.channel()) === "dev") {
		try {
			await fetch(WEB_DEV_SERVER_URL, { method: "HEAD" });
			console.log(
				`HMR enabled: using the web dev server at ${WEB_DEV_SERVER_URL}`,
			);
			return WEB_DEV_SERVER_URL;
		} catch {
			console.log(
				"The web dev server is not running. Run dev:hmr for live reload.",
			);
		}
	}
	return PACKAGED_VIEW_URL;
}

let daemon: Daemon | undefined;
// Set once the daemon has given the database lease up: the app may quit.
let released = false;

const updates = await startUpdates({
	onChange: () => setMenus(),
	beforeRestart: async () => {
		await daemon?.stop();
		released = true;
	},
});

/** "Check for Updates…" or the update that waits, and the nightly choice. */
function updateItems() {
	if (!updates.enabled) return [];
	const ready = updates.readyVersion();
	return [
		ready
			? { label: `Restart to Install ${ready}`, action: "install-update" }
			: { label: "Check for Updates…", action: "check-updates" },
		{
			label: "Get Nightly Builds",
			action: "toggle-nightly",
			checked: updates.feed() === "nightly",
		},
	];
}

let tray: Tray | undefined;

function setMenus(): void {
	setApplicationMenu();
	tray?.setMenu([
		{ type: "normal", label: `Open ${APP_NAME}`, action: "open" },
		{ type: "divider" },
		...updateItems().map((item) => ({ type: "normal" as const, ...item })),
		...(updates.enabled ? [{ type: "divider" as const }] : []),
		{
			type: "normal",
			label:
				daemon?.kind === "shared"
					? `Close this window (${APP_NAME} keeps running in the terminal)`
					: `Quit ${APP_NAME}`,
			action: "quit",
		},
	]);
}

// The webview takes Cmd+C, Cmd+V and Cmd+Z only through menu roles.
function setApplicationMenu(): void {
	ApplicationMenu.setApplicationMenu([
		{
			submenu: [
				{ role: "about" },
				...updateItems(),
				{ type: "divider" },
				{ role: "hide", accelerator: "h" },
				{ role: "hideOthers" },
				{ role: "showAll" },
				{ type: "divider" },
				{ label: `Quit ${APP_NAME}`, action: "quit", accelerator: "q" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "divider" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "pasteAndMatchStyle" },
				{ role: "delete" },
				{ role: "selectAll" },
			],
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				{ role: "close" },
				{ type: "divider" },
				{ role: "bringAllToFront" },
			],
		},
	]);
}
setMenus();

/** What the main window shows: the daemon shows no notification for it. */
const windowState = trackWindow();

try {
	daemon = await startDaemon({
		notifier: electrobunNotifier((options) => Utils.showNotification(options)),
		window: windowState,
	});
} catch (error) {
	console.error(error);
	await Utils.showMessageBox({
		type: "error",
		title: APP_NAME,
		message: `${APP_NAME} cannot start.`,
		detail:
			error instanceof PortTakenError
				? `${error.message} Close that program, then open ${APP_NAME} again.`
				: String(error instanceof Error ? error.message : error),
		buttons: ["Quit"],
	});
	Utils.quit(1);
	throw error;
}

const url = await mainViewUrl();
let mainWindow: BrowserWindow | null = null;

/** Shows the window, or opens a new one after it was closed. */
function showWindow(): void {
	if (mainWindow) {
		mainWindow.show();
		mainWindow.activate();
		windowState.focused();
		return;
	}
	const window = new BrowserWindow({
		title: APP_NAME,
		url,
		// The page knows it is in the desktop app, which shows the
		// notifications itself, and which daemon to call. The packaged view
		// loads /index.html: start the router at /.
		preload: `window.nightshiftDesktop = true; window.nightshiftDaemonUrl = ${JSON.stringify(DAEMON_URL)};${
			url.startsWith("views://") ? ' history.replaceState(null, "", "/");' : ""
		}`,
		frame: { width: 1280, height: 820, x: 120, y: 120 },
	});
	windowState.opened();
	window.on("focus", () => {
		if (mainWindow === window) windowState.focused();
	});
	window.on("blur", () => {
		if (mainWindow === window) windowState.blurred();
	});
	const navigated = (event: unknown) => {
		const url = (event as { data?: { detail?: unknown } }).data?.detail;
		if (mainWindow === window && typeof url === "string") {
			windowState.navigated(url);
		}
	};
	window.webview.on("did-navigate", navigated);
	window.webview.on("did-navigate-in-page", navigated);
	window.on("close", () => {
		if (mainWindow !== window) return;
		mainWindow = null;
		windowState.closed();
	});
	mainWindow = window;
}

// Runs go on when the window closes: the app stays in the menu bar until you quit.
// A template image: macOS tints it to match the menu bar.
tray = new Tray({
	image: "views://tray-icon.png",
	template: true,
	width: 18,
	height: 18,
});
setMenus();

function onAction(action: string): void {
	if (action === "open") showWindow();
	if (action === "quit") Utils.quit();
	if (action === "check-updates") updates.checkNow();
	if (action === "install-update") void updates.restart();
	if (action === "toggle-nightly") {
		updates.setFeed(updates.feed() === "nightly" ? "stable" : "nightly");
	}
}
tray.on("tray-clicked", (event) => {
	onAction((event as { data: { action: string } }).data.action);
});
ApplicationMenu.on("application-menu-clicked", (event) => {
	onAction((event as { data: { action: string } }).data.action);
});
// A click on the Dock icon opens the window again.
Electrobun.events.on("reopen", () => showWindow());

// Quit once the daemon has given the database lease up.
Electrobun.events.on(
	"before-quit",
	(event: { response?: { allow: boolean } }) => {
		if (released || !daemon) return;
		event.response = { allow: false };
		void daemon.stop().finally(() => {
			released = true;
			Utils.quit();
		});
	},
);

showWindow();
console.log(`${APP_NAME} desktop app started.`);
