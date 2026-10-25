import { describe, expect, test } from "bun:test";

import type { RunStreamConnection } from "../runs";
import { followNotifications, type NotificationWatchClient } from "./stream";
import type { NotificationItem } from "./types";

/** One connection of the fake: what it sends, then how it ends. */
type Connection = {
	items: NotificationItem[];
	/** "drop": the stream throws after its items. "end": it ends. "refuse": the call fails. */
	ending: "drop" | "end" | "refuse";
};

const opened = (stepId: string): NotificationItem => ({
	kind: "gate-opened",
	key: `run-1:${stepId}`,
	spaceId: "space-1",
	runId: "run-1",
	stepId,
	title: "A Gate waits for you",
	alert: true,
	at: 1,
});

const closed = (stepId: string): NotificationItem => ({
	kind: "gate-closed",
	key: `run-1:${stepId}`,
	runId: "run-1",
	stepId,
	at: 2,
});

/**
 * A fake `notifications.watch` that plays one connection per call. After
 * the last one it stops the stream, as a person who closes the page.
 */
async function follow(connections: Connection[]) {
	const controller = new AbortController();
	let calls = 0;
	const client: NotificationWatchClient = {
		notifications: {
			async watch() {
				calls += 1;
				const next = connections.shift();
				if (!next) {
					controller.abort();
					throw new Error("closed");
				}
				if (next.ending === "refuse") throw new Error("offline");
				return (async function* () {
					for (const item of next.items) yield item;
					if (next.ending === "drop") throw new Error("dropped");
				})();
			},
		},
	};
	const items: string[] = [];
	const states: RunStreamConnection[] = [];
	const delays: number[] = [];
	await followNotifications({
		client,
		signal: controller.signal,
		onItem: (item) => items.push(`${item.kind} ${item.key}`),
		onConnection: (state) => states.push(state),
		wait: async (ms) => {
			delays.push(ms);
		},
	});
	return { items, states, delays, calls: () => calls };
}

describe("the stream of the person's notifications", () => {
	test("hands on each item in order, across connections", async () => {
		const run = await follow([
			{ items: [opened("review")], ending: "drop" },
			{ items: [closed("review"), opened("deploy")], ending: "end" },
		]);
		expect(run.items).toEqual([
			"gate-opened run-1:review",
			"gate-closed run-1:review",
			"gate-opened run-1:deploy",
		]);
	});

	test("waits longer after each failed try, up to 15 seconds", async () => {
		const refuse: Connection = { items: [], ending: "refuse" };
		const run = await follow([refuse, refuse, refuse, refuse, refuse, refuse]);
		expect(run.delays).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
	});

	test("starts the wait again at one second once the stream is live", async () => {
		const run = await follow([
			{ items: [], ending: "refuse" },
			{ items: [], ending: "refuse" },
			{ items: [], ending: "drop" },
			{ items: [], ending: "refuse" },
		]);
		expect(run.delays).toEqual([1000, 2000, 1000, 2000]);
	});

	test("says when it is live and when it reconnects", async () => {
		const run = await follow([
			{ items: [opened("review")], ending: "drop" },
			{ items: [], ending: "refuse" },
			{ items: [], ending: "end" },
		]);
		expect(run.states).toEqual([
			"connecting",
			"live",
			"reconnecting",
			"reconnecting",
			"live",
			"reconnecting",
		]);
	});

	test("the phone app says so on each connection; a page says nothing", async () => {
		const inputs: unknown[] = [];
		for (const phone of [true, false]) {
			const controller = new AbortController();
			await followNotifications({
				client: {
					notifications: {
						async watch(input) {
							inputs.push(input);
							controller.abort();
							return (async function* () {})();
						},
					},
				},
				phone,
				signal: controller.signal,
				onItem: () => {},
			});
		}
		expect(inputs).toEqual([{ phone: true }, undefined]);
	});

	test("stops at once when the signal aborts", async () => {
		const controller = new AbortController();
		controller.abort();
		let calls = 0;
		await followNotifications({
			client: {
				notifications: {
					async watch() {
						calls += 1;
						return (async function* () {})();
					},
				},
			},
			signal: controller.signal,
			onItem: () => {},
		});
		expect(calls).toBe(0);
	});
});
