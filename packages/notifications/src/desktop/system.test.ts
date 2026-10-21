import { describe, expect, test } from "bun:test";

import { fakePrograms } from "../testing";
import type { DesktopNotice } from "./desktop";
import { systemDesktopNotifier } from "./system";

const notice: DesktopNotice = {
	id: "run-1:step-1",
	title: "A Gate waits for you",
	body: "Open the inbox to answer it.",
	open: "/inbox?gate=step-1",
};

const pageUrl = (path: string) => `http://localhost:3001${path}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function notifier(
	platform: NodeJS.Platform,
	installed: string[],
	env: Record<string, string> = {},
) {
	const programs = fakePrograms(installed);
	const desktop = systemDesktopNotifier({
		pageUrl,
		platform,
		env,
		programs,
		onError: (message, error) => {
			throw new Error(`${message} ${String(error)}`);
		},
	});
	return { programs, desktop };
}

describe("macOS", () => {
	test("terminal-notifier: a click opens the page, and the notice can be taken back", async () => {
		const { programs, desktop } = notifier("darwin", [
			"terminal-notifier",
			"osascript",
		]);
		await desktop?.show(notice);
		await desktop?.withdraw(notice.id);
		expect(programs.commands()).toEqual([
			[
				"/bin/terminal-notifier",
				"-title",
				"Night Shift",
				"-subtitle",
				"A Gate waits for you",
				"-message",
				"Open the inbox to answer it.",
				"-group",
				"run-1:step-1",
				"-open",
				"http://localhost:3001/inbox?gate=step-1",
			],
			["/bin/terminal-notifier", "-remove", "run-1:step-1"],
		]);
	});

	test("osascript: the words are arguments, never script text; no withdraw", async () => {
		const { programs, desktop } = notifier("darwin", ["osascript"]);
		await desktop?.show({ ...notice, title: 'A "quoted" title' });
		await desktop?.withdraw(notice.id);
		expect(programs.commands()).toEqual([
			[
				"/bin/osascript",
				"-e",
				"on run argv",
				"-e",
				"display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)",
				"-e",
				"end run",
				"Night Shift",
				'A "quoted" title',
				"Open the inbox to answer it.",
			],
		]);
	});
});

describe("Linux", () => {
	const desktopSession = { WAYLAND_DISPLAY: "wayland-0" };

	test("no desktop session, no notify-send, or Windows: no desktop notification", () => {
		expect(notifier("linux", ["notify-send"]).desktop).toBeNull();
		expect(notifier("linux", [], desktopSession).desktop).toBeNull();
		expect(notifier("win32", ["notify-send"]).desktop).toBeNull();
	});

	test("notify-send waits for a click, which opens the page", async () => {
		const { programs, desktop } = notifier(
			"linux",
			["notify-send", "xdg-open"],
			desktopSession,
		);
		await desktop?.show(notice);
		const shown = programs.started[0];
		expect(shown?.command).toEqual([
			"/bin/notify-send",
			"--app-name=Night Shift",
			"--print-id",
			"--action=default=Open",
			"--wait",
			"A Gate waits for you",
			"Open the inbox to answer it.",
		]);
		shown?.print("42");
		shown?.print("default");
		shown?.exit(0);
		await settle();
		expect(programs.commands()[1]).toEqual([
			"/bin/xdg-open",
			"http://localhost:3001/inbox?gate=step-1",
		]);
	});

	test("a withdraw closes the notice by its id, with gdbus", async () => {
		const { programs, desktop } = notifier("linux", ["notify-send", "gdbus"], {
			DISPLAY: ":0",
		});
		await desktop?.show(notice);
		const shown = programs.started[0];
		shown?.print("42");
		await settle();
		await desktop?.withdraw(notice.id);
		await settle();
		expect(programs.commands()[1]).toEqual([
			"/bin/gdbus",
			"call",
			"--session",
			"--dest=org.freedesktop.Notifications",
			"--object-path=/org/freedesktop/Notifications",
			"--method=org.freedesktop.Notifications.CloseNotification",
			"42",
		]);
		expect(shown?.killed).toBe(true);
		// A withdrawn notice shows nothing again, and withdraws once.
		await desktop?.withdraw(notice.id);
		expect(programs.started).toHaveLength(2);
	});

	test("an older notify-send that turns the options down gets the plain notice from then on", async () => {
		const { programs, desktop } = notifier(
			"linux",
			["notify-send"],
			desktopSession,
		);
		await desktop?.show(notice);
		programs.started[0]?.exit(1);
		await settle();
		await desktop?.show({ ...notice, id: "run-2:step-1" });
		expect(programs.commands().slice(1)).toEqual([
			[
				"/bin/notify-send",
				"--app-name=Night Shift",
				"A Gate waits for you",
				"Open the inbox to answer it.",
			],
			[
				"/bin/notify-send",
				"--app-name=Night Shift",
				"A Gate waits for you",
				"Open the inbox to answer it.",
			],
		]);
	});
});
