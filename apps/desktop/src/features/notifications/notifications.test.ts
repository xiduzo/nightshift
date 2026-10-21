import { describe, expect, test } from "bun:test";

import { electrobunNotifier, trackWindow } from "./notifications";

describe("the desktop app's notifications", () => {
	test("show through Electrobun, with the notice's words; a withdraw does nothing", async () => {
		const shown: { title: string; body?: string }[] = [];
		const notifier = electrobunNotifier((options) => shown.push(options));
		await notifier.show({
			id: "run-1:step-1",
			title: "A Gate waits for you",
			body: "Open the inbox to answer it.",
			open: "/inbox?gate=step-1",
		});
		await notifier.withdraw("run-1:step-1");
		expect(shown).toEqual([
			{ title: "A Gate waits for you", body: "Open the inbox to answer it." },
		]);
	});
});

describe("the window state", () => {
	test("follows the focus and the page of the open window", () => {
		const window = trackWindow();
		expect(window.state()).toEqual({ focused: false, path: null });

		window.opened();
		window.navigated("views://mainview/inbox?gate=step-1");
		expect(window.state()).toEqual({ focused: true, path: "/inbox" });

		window.blurred();
		expect(window.state()).toEqual({ focused: false, path: "/inbox" });

		window.focused();
		window.navigated("http://localhost:3001/runs/run-1");
		expect(window.state()).toEqual({ focused: true, path: "/runs/run-1" });

		window.navigated("not a url");
		expect(window.state()).toEqual({ focused: true, path: null });

		window.closed();
		expect(window.state()).toEqual({ focused: false, path: null });
	});
});
