import Electrobun, {
	ApplicationMenu,
	BrowserWindow,
	Tray,
	Updater,
	Utils,
} from "electrobun/main";

import { type Daemon, PortTakenError, startDaemon } from "./daemon";

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

// The webview takes Cmd+C, Cmd+V and Cmd+Z only through menu roles.
ApplicationMenu.setApplicationMenu([
	{
		submenu: [
			{ role: "about" },
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

let daemon: Daemon;
try {
	daemon = await startDaemon();
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
		return;
	}
	const window = new BrowserWindow({
		title: APP_NAME,
		url,
		// The packaged view loads /index.html: start the router at /.
		preload: url.startsWith("views://")
			? 'history.replaceState(null, "", "/");'
			: undefined,
		frame: { width: 1280, height: 820, x: 120, y: 120 },
	});
	window.on("close", () => {
		if (mainWindow === window) mainWindow = null;
	});
	mainWindow = window;
}

// Runs go on when the window closes: the app stays in the menu bar until you quit.
const tray = new Tray({ title: "☾" });
tray.setMenu([
	{ type: "normal", label: `Open ${APP_NAME}`, action: "open" },
	{ type: "divider" },
	{
		type: "normal",
		label:
			daemon.kind === "own"
				? `Quit ${APP_NAME}`
				: `Close this window (${APP_NAME} keeps running in the terminal)`,
		action: "quit",
	},
]);

function onAction(action: string): void {
	if (action === "open") showWindow();
	if (action === "quit") Utils.quit();
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
let released = false;
Electrobun.events.on(
	"before-quit",
	(event: { response?: { allow: boolean } }) => {
		if (released) return;
		event.response = { allow: false };
		void daemon.stop().finally(() => {
			released = true;
			Utils.quit();
		});
	},
);

showWindow();
console.log(`${APP_NAME} desktop app started.`);
