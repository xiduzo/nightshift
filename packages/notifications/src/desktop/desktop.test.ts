import { describe, expect, test } from "bun:test";

import type { NotificationMessage } from "../channels";
import type { PushTarget } from "../targets";
import { fakeDesktopNotifier } from "../testing";
import { createDesktopChannel, type DesktopWindowState } from "./desktop";

const DEVICE = "device-1";

const target = (endpoint = DEVICE, personId = "ada"): PushTarget => ({
	id: "target-1",
	personId,
	kind: "desktop",
	name: "Ada's Mac",
	platform: "darwin",
	endpoint,
	keys: null,
	sessionId: null,
	createdAt: 0,
	lastSeenAt: null,
});

const gate: NotificationMessage = {
	key: "run-1:step-1",
	kind: "gate-opened",
	spaceId: "space-1",
	runId: "run-1",
	stepId: "step-1",
	title: "A Gate waits for you",
	alert: true,
	count: null,
	at: 1,
};

const failed: NotificationMessage = {
	...gate,
	key: "run-1:end:9",
	kind: "run-failed",
	stepId: null,
	title: "A run failed",
};

function channel(
	options: { window?: DesktopWindowState | null; streamHere?: boolean } = {},
) {
	const notifier = fakeDesktopNotifier();
	const desktop = createDesktopChannel({
		deviceId: DEVICE,
		ownerId: "ada",
		notifier,
		...(options.window !== undefined
			? { window: { state: () => options.window ?? null } }
			: {}),
		streamHere: () => options.streamHere ?? false,
	});
	return { notifier, desktop };
}

describe("the desktop channel", () => {
	test("shows a notice that opens the Gate in the inbox, and takes it back", async () => {
		const { notifier, desktop } = channel();
		expect(await desktop.send(target(), gate)).toBe("sent");
		await desktop.withdraw(target(), gate.key);
		expect(notifier.shown).toEqual([
			{
				id: "run-1:step-1",
				title: "A Gate waits for you",
				body: "Open the inbox to answer it.",
				open: "/inbox?gate=step-1",
			},
		]);
		expect(notifier.withdrawn).toEqual(["run-1:step-1"]);
	});

	test("a run that ended opens the run", async () => {
		const { notifier, desktop } = channel();
		await desktop.send(target(), failed);
		expect(notifier.shown[0]).toMatchObject({
			title: "A run failed",
			open: "/runs/run-1",
		});
	});

	test("reaches this computer only: another computer's desktop is gone here", async () => {
		const { notifier, desktop } = channel();
		expect(await desktop.send(target("device-2"), gate)).toBe("gone");
		await desktop.withdraw(target("device-2"), gate.key);
		expect(notifier.shown).toEqual([]);
		expect(notifier.withdrawn).toEqual([]);
	});

	test("shows only its owner's notifications: another Person's target of this computer is gone", async () => {
		const { notifier, desktop } = channel();
		expect(await desktop.send(target(DEVICE, "mallory"), gate)).toBe("gone");
		await desktop.withdraw(target(DEVICE, "mallory"), gate.key);
		expect(notifier.shown).toEqual([]);
		expect(notifier.withdrawn).toEqual([]);
	});

	test("the focused window on the inbox shows the Gate already", async () => {
		const { notifier, desktop } = channel({
			window: { focused: true, path: "/inbox/" },
			streamHere: true,
		});
		expect(await desktop.send(target(), gate)).toBe("sent");
		await desktop.send(target(), failed);
		expect(notifier.shown.map((n) => n.id)).toEqual(["run-1:end:9"]);
	});

	test("the focused window on the run shows its end already", async () => {
		const { notifier, desktop } = channel({
			window: { focused: true, path: "/runs/run-1" },
		});
		await desktop.send(target(), failed);
		await desktop.send(target(), gate);
		expect(notifier.shown.map((n) => n.id)).toEqual(["run-1:step-1"]);
	});

	test("a window in the background does not count, whatever page is open", async () => {
		const { notifier, desktop } = channel({
			window: { focused: false, path: "/inbox" },
			streamHere: true,
		});
		await desktop.send(target(), gate);
		expect(notifier.shown).toHaveLength(1);
	});

	test("without the window state, an open page on this computer goes first", async () => {
		const unknown = channel({ window: null, streamHere: true });
		await unknown.desktop.send(target(), gate);
		expect(unknown.notifier.shown).toEqual([]);

		const noPath = channel({
			window: { focused: true, path: null },
			streamHere: false,
		});
		await noPath.desktop.send(target(), gate);
		expect(noPath.notifier.shown).toHaveLength(1);
	});
});
