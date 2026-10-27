import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	gateKey,
	type PushData,
	routeOf,
	staleGates,
	webPathOf,
} from "@nightshift/client";

/**
 * The service worker (`public/sw.js`) is plain JavaScript and cannot import
 * the push contract. This test runs it in a fake service worker scope and
 * checks each push against the contract: the tag is the key, a click goes
 * where `webPathOf(routeOf(push))` says, and an open page can find a closed
 * Gate's notification (`staleGates`).
 */

const SOURCE = readFileSync(
	join(import.meta.dir, "../../../public/sw.js"),
	"utf8",
);
const ORIGIN = "https://nightshift.example";

type Shown = {
	title: string;
	tag: string;
	body?: string;
	data: { path: string; kind: string; shownAt: number };
};
type Tab = {
	focused: boolean;
	visibilityState: string;
	focus(): Promise<void>;
	postMessage(message: unknown): void;
};
type Listener = (event: Record<string, unknown>) => void;

/** Runs the worker on a fake scope. */
function worker(tabs: Tab[] = []) {
	const listeners = new Map<string, Listener>();
	const shown: Shown[] = [];
	const opened: string[] = [];
	const self = {
		location: { origin: ORIGIN },
		addEventListener: (type: string, listener: Listener) => {
			listeners.set(type, listener);
		},
		skipWaiting: () => {},
		registration: {
			showNotification: async (
				title: string,
				options: Omit<Shown, "title">,
			) => {
				shown.push({ title, ...options });
			},
		},
		clients: {
			claim: async () => {},
			matchAll: async () => tabs,
			openWindow: async (url: string) => {
				opened.push(url);
			},
		},
	};
	new Function("self", SOURCE)(self);

	/** Fires an event and waits for what it hands to `waitUntil`. */
	async function fire(type: string, event: Record<string, unknown>) {
		const waits: Promise<unknown>[] = [];
		listeners.get(type)?.({
			...event,
			waitUntil: (promise: Promise<unknown>) => waits.push(promise),
		});
		await Promise.all(waits);
	}

	return {
		shown,
		opened,
		push: (body: unknown) =>
			fire("push", {
				data: {
					json: () => (typeof body === "string" ? JSON.parse(body) : body),
				},
			}),
		click: (data: unknown) =>
			fire("notificationclick", { notification: { data, close: () => {} } }),
	};
}

const pushes: PushData[] = [
	{
		kind: "gate-opened",
		key: gateKey({ runId: "run-1", stepId: "review step" }),
		spaceId: "space-1",
		runId: "run-1",
		stepId: "review step",
	},
	{
		kind: "gate-opened",
		key: "run-1:review",
		spaceId: "space-1",
		runId: null,
		stepId: "review",
	},
	{
		kind: "run-finished",
		key: "run-1:end:3",
		spaceId: "space-1",
		runId: "run-1",
		stepId: null,
	},
	{
		kind: "run-failed",
		key: "run-2:end:1",
		spaceId: "space-1",
		runId: null,
		stepId: null,
	},
	{
		kind: "device-wait",
		key: "run-3:wait:build",
		spaceId: "space-1",
		runId: "run-3",
		stepId: "build",
	},
	{
		kind: "gates-waiting",
		key: "waiting:5",
		spaceId: null,
		runId: null,
		stepId: null,
		count: 2,
	},
];

describe("the service worker", () => {
	test("shows each push by its key, and a click goes where the contract says", async () => {
		for (const push of pushes) {
			const sw = worker();
			await sw.push({ type: "show", title: "A Gate waits for you", ...push });
			expect(sw.shown).toHaveLength(1);
			const [one] = sw.shown;
			expect(one?.tag).toBe(push.key);
			expect(one?.data.kind).toBe(push.kind);
			expect(one?.data.path).toBe(webPathOf(routeOf(push)));
			expect(typeof one?.data.shownAt).toBe("number");
		}
	});

	test("a step that waits for a device shows its second line, and opens its run", async () => {
		const sw = worker();
		await sw.push({
			type: "show",
			kind: "device-wait",
			key: "run-3:wait:build",
			spaceId: "space-1",
			runId: "run-3",
			stepId: "build",
			title: "Triage waits for studio-mac",
			body: "The step starts when the device is back.",
		});
		expect(sw.shown[0]).toMatchObject({
			title: "Triage waits for studio-mac",
			body: "The step starts when the device is back.",
			data: { path: "/runs/run-3", kind: "device-wait" },
		});
	});

	test("an open page finds the notification of a Gate that no longer waits", async () => {
		const sw = worker();
		for (const push of pushes)
			await sw.push({ type: "show", title: "", ...push });
		const shown = sw.shown.map((one) => ({
			key: one.tag,
			at: one.data.shownAt,
		}));
		const readAt = Math.max(...shown.map((one) => one.at)) + 60_000;
		expect(staleGates(shown, new Set(["run-1:review"]), readAt)).toEqual([
			{ key: "run-1:review step", at: shown[0]?.at ?? 0 },
		]);
	});

	test("a push that is not a show, or not valid, shows nothing", async () => {
		const sw = worker();
		await sw.push({ ...pushes[0], type: "withdraw" });
		await sw.push({ type: "show", title: "x" });
		await sw.push(null);
		expect(sw.shown).toEqual([]);
	});

	test("a click opens the path in an open tab, or in a new one", async () => {
		const messages: unknown[] = [];
		const tab: Tab = {
			focused: true,
			visibilityState: "visible",
			focus: async () => {},
			postMessage: (message) => messages.push(message),
		};
		const withTab = worker([tab]);
		await withTab.click({ path: "/runs/run-1" });
		expect(messages).toEqual([
			{ type: "nightshift:open", path: "/runs/run-1" },
		]);

		const alone = worker();
		await alone.click({ path: "/runs/run-1" });
		await alone.click(undefined);
		expect(alone.opened).toEqual([`${ORIGIN}/runs/run-1`, `${ORIGIN}/inbox`]);
	});
});
