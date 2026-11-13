/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { accessoryView, createBarStore, type NeedsBar } from "./needs-bar";

const BAR: NeedsBar = {
	position: 2,
	total: 5,
	from: "Daily digest",
	choice: null,
	prompt: "Choose an answer",
	action: {
		label: "Sign off",
		busyLabel: "Signing off…",
		busy: false,
		disabled: true,
	},
};

describe("accessoryView", () => {
	test("no bar when nothing waits and nothing shows", () => {
		expect(accessoryView(null, 0)).toBeNull();
	});

	test("before the page shows a thing: only the count", () => {
		expect(accessoryView(null, 3)).toEqual({
			caption: null,
			label: "3 things wait for you",
			color: null,
			short: "3 things wait for you",
			action: null,
		});
	});

	test("where you are, what to do, and a button that waits for a choice", () => {
		expect(accessoryView(BAR, 5)).toEqual({
			caption: "2 of 5 · Daily digest",
			label: "Choose an answer",
			color: null,
			short: "5 things wait for you",
			action: { label: "Sign off", disabled: true },
		});
	});

	test("the option you chose in its color, and the button while it works", () => {
		const view = accessoryView(
			{
				...BAR,
				choice: { name: "Roll back", color: "red", destructive: true },
				action: {
					label: "Sign off",
					busyLabel: "Checking…",
					busy: true,
					disabled: false,
				},
			},
			1,
		);
		expect(view?.label).toBe("Roll back");
		expect(view?.color).toBe("red");
		expect(view?.short).toBe("1 thing waits for you");
		expect(view?.action).toEqual({ label: "Checking…", disabled: true });
	});
});

describe("createBarStore", () => {
	test("tells its readers only when what the bar shows changes", () => {
		const store = createBarStore();
		let told = 0;
		const stop = store.subscribe(() => {
			told += 1;
		});
		store.set(BAR, () => {});
		store.set({ ...BAR }, () => {});
		expect(told).toBe(1);
		store.set({ ...BAR, position: 3 }, () => {});
		expect(told).toBe(2);
		store.set(null, () => {});
		expect(store.get()).toBeNull();
		expect(told).toBe(3);
		stop();
		store.set(BAR, () => {});
		expect(told).toBe(3);
	});

	test("sends with the newest send, also when the bar stays the same", () => {
		const store = createBarStore();
		const sent: string[] = [];
		store.set(BAR, () => sent.push("first"));
		store.set(BAR, () => sent.push("second"));
		store.send();
		expect(sent).toEqual(["second"]);
	});
});
