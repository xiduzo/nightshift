import { describe, expect, test } from "bun:test";

import type { NotificationMessage } from "../channels";
import { expoMessage, expoWithdrawMessage } from "../channels/expo";
import {
	deviceWaitKey,
	digestKey,
	gateKey,
	isGateKey,
	type PushData,
	parseDeviceWaitKey,
	parseGateKey,
	pushDataOf,
	routeOf,
	runEndKey,
	waitingKey,
	webPathOf,
	withdrawKeyOf,
} from ".";
import { parseKey } from "./keys";

describe("a notification key", () => {
	test("a Gate's key is its run and step, and reads back", () => {
		const key = gateKey({ runId: "run-1", stepId: "review" });
		expect(key).toBe("run-1:review");
		expect(parseKey(key)).toEqual({
			kind: "gate",
			runId: "run-1",
			stepId: "review",
		});
		expect(parseGateKey(key)).toEqual({ runId: "run-1", stepId: "review" });
		expect(isGateKey(key)).toBe(true);
	});

	test("a run's end and the end of quiet hours are not Gates", () => {
		expect(runEndKey("run-1", 7)).toBe("run-1:end:7");
		expect(parseKey("run-1:end:7")).toEqual({
			kind: "run-end",
			runId: "run-1",
			seq: 7,
		});
		expect(waitingKey(1700000000000)).toBe("waiting:1700000000000");
		expect(parseKey("waiting:1700000000000")).toEqual({
			kind: "waiting",
			at: 1700000000000,
		});
		for (const key of ["run-1:end:7", "waiting:1"]) {
			expect(parseGateKey(key)).toBeNull();
			expect(isGateKey(key)).toBe(false);
		}
	});

	test("a device wait's key is its run and step, and is no Gate", () => {
		const key = deviceWaitKey({ runId: "run-1", stepId: "build" });
		expect(key).toBe("run-1:wait:build");
		expect(parseKey(key)).toEqual({
			kind: "device-wait",
			runId: "run-1",
			stepId: "build",
		});
		expect(parseDeviceWaitKey(key)).toEqual({
			runId: "run-1",
			stepId: "build",
		});
		expect(parseDeviceWaitKey("run-1:build")).toBeNull();
		expect(parseGateKey(key)).toBeNull();
		expect(isGateKey(key)).toBe(false);
	});

	test("a digest's key is its day, and is no Gate", () => {
		const key = digestKey("2026-10-21");
		expect(key).toBe("digest:2026-10-21");
		expect(parseKey(key)).toEqual({ kind: "digest", day: "2026-10-21" });
		expect(isGateKey(key)).toBe(false);
		expect(parseKey("digest:today")).toBeNull();
	});

	test("a key Night Shift does not make names nothing", () => {
		for (const key of ["run-1", ":review", "run-1:", "a:b:c", "waiting:x"]) {
			expect(parseKey(key)).toBeNull();
			expect(isGateKey(key)).toBe(false);
		}
		expect(parseKey("run-1:end:x")).toBeNull();
	});
});

/** A push as the Host's Expo channel sends it (`expoMessage`). */
const lockScreenGate = {
	kind: "gate-opened",
	key: "run-1:review",
	spaceId: "space-1",
	runId: "run-1",
	stepId: "review",
	options: [
		{ id: "ship", label: "Ship it" },
		{ id: "hold", label: "Hold" },
	],
};

describe("the data of a push", () => {
	test("reads a Gate with its two options", () => {
		expect(pushDataOf(lockScreenGate)).toEqual(lockScreenGate as PushData);
	});

	test("a push without the Host's kind or key is not one of the Host's", () => {
		expect(pushDataOf({ withdraw: "run-1:review" })).toBeNull();
		expect(pushDataOf({ kind: "other", key: "x" })).toBeNull();
		expect(pushDataOf({ kind: "gate-opened" })).toBeNull();
		expect(pushDataOf(null)).toBeNull();
		expect(pushDataOf("text")).toBeNull();
	});

	test("options are kept only when there are exactly two", () => {
		const three = {
			...lockScreenGate,
			options: [{ id: "a" }, { id: "b" }, { id: "c" }],
		};
		expect(pushDataOf(three)?.options).toBeUndefined();
		const noLabel = { ...lockScreenGate, options: [{ id: "a" }, { id: "b" }] };
		expect(pushDataOf(noLabel)?.options).toEqual([
			{ id: "a", label: "a" },
			{ id: "b", label: "b" },
		]);
	});

	test("the end of quiet hours has no run, and says how many Gates wait", () => {
		expect(
			pushDataOf({
				kind: "gates-waiting",
				key: "waiting:5",
				spaceId: null,
				runId: null,
				stepId: null,
				count: 3,
			}),
		).toEqual({
			kind: "gates-waiting",
			key: "waiting:5",
			spaceId: null,
			runId: null,
			stepId: null,
			count: 3,
		});
	});

	test("a withdraw push names only its key", () => {
		expect(withdrawKeyOf({ withdraw: "run-1:review" })).toBe("run-1:review");
		expect(withdrawKeyOf(lockScreenGate)).toBeNull();
		expect(withdrawKeyOf({ withdraw: "" })).toBeNull();
		expect(withdrawKeyOf(undefined)).toBeNull();
	});
});

describe("where a tap goes", () => {
	const at = (
		kind: string,
		runId: string | null,
		stepId: string | null = null,
	) => webPathOf(routeOf({ kind, runId, stepId }));

	test("a Gate opens the Gate in the inbox", () => {
		expect(routeOf(lockScreenGate)).toEqual({
			to: "gate",
			runId: "run-1",
			stepId: "review",
		});
		expect(at("gate-opened", "run-1", "a b")).toBe("/inbox?gate=a%20b");
	});

	test("a run's end opens the run", () => {
		expect(
			routeOf({ kind: "run-failed", runId: "run-1", stepId: null }),
		).toEqual({ to: "run", runId: "run-1" });
		expect(at("run-finished", "run-1")).toBe("/runs/run-1");
		expect(at("run-failed", "run-1")).toBe("/runs/run-1");
	});

	test("a step that waits for a device opens its run", () => {
		expect(
			routeOf({ kind: "device-wait", runId: "run-1", stepId: "build" }),
		).toEqual({ to: "run", runId: "run-1" });
		expect(at("device-wait", "run-1", "build")).toBe("/runs/run-1");
		expect(at("device-wait", null, "build")).toBe("/inbox");
	});

	test("anything else, or a push without its ids, opens the inbox", () => {
		expect(at("gates-waiting", null)).toBe("/inbox");
		expect(at("digest", null)).toBe("/inbox");
		expect(at("run-finished", null)).toBe("/inbox");
		expect(at("gate-opened", "run-1")).toBe("/inbox");
		expect(at("gate-opened", null, "review")).toBe("/inbox");
		expect(at("other", "run-1", "review")).toBe("/inbox");
	});
});

describe("from the Host to the phone", () => {
	const message = (
		over: Partial<NotificationMessage>,
	): NotificationMessage => ({
		key: "run-1:review",
		kind: "gate-opened",
		spaceId: "space-1",
		runId: "run-1",
		stepId: "review",
		title: "A Gate waits for you",
		alert: true,
		count: null,
		at: 1,
		...over,
	});

	test("the data of each push the Host sends reads back the same", () => {
		const sent = [
			message({
				gate: { lockScreen: true, options: lockScreenGate.options },
			}),
			message({ kind: "run-finished", key: "run-1:end:3", stepId: null }),
			message({
				kind: "device-wait",
				key: "run-1:wait:review",
				title: "Triage waits for studio-mac",
				body: "The step starts when the device is back.",
			}),
			message({
				kind: "gates-waiting",
				key: "waiting:5",
				spaceId: null,
				runId: null,
				stepId: null,
				count: 2,
			}),
			message({
				kind: "digest",
				key: "digest:2026-10-21",
				spaceId: null,
				runId: null,
				stepId: null,
				title: "Night Shift: last night",
				body: "3 runs finished, 1 failed. $4.20 spent.",
			}),
		];
		for (const one of sent) {
			const { data } = expoMessage("token", one);
			expect(pushDataOf(data)).toEqual(data as PushData);
		}
	});

	test("a digest goes to the runs channel and opens the inbox", () => {
		const push = expoMessage(
			"token",
			message({
				kind: "digest",
				key: "digest:2026-10-21",
				spaceId: null,
				runId: null,
				stepId: null,
				title: "Night Shift: last night",
				body: "1 run finished.",
			}),
		);
		expect(push).toMatchObject({
			title: "Night Shift: last night",
			body: "1 run finished.",
			categoryId: "gate-open",
			channelId: "runs",
			priority: "normal",
		});
	});

	test("a withdraw push reads back its key", () => {
		const { data } = expoWithdrawMessage("token", "run-1:review");
		expect(withdrawKeyOf(data)).toBe("run-1:review");
		expect(pushDataOf(data)).toBeNull();
	});
});
