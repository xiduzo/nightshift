/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { pushDataOf, routeOf, withdrawKeyOf } from "@nightshift/client";

import {
	answerOfAction,
	permissionOf,
	phoneRouteOf,
	showInFront,
	shownAtMs,
	shownWithKey,
	taskDataOf,
} from "./push-data";

/** A push as the Host's Expo channel sends it (`expoMessage`). The contract's own tests read it in full. */
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

const plainGate = { ...lockScreenGate, options: undefined };

describe("a button on the lock screen", () => {
	const data = pushDataOf(lockScreenGate);

	test("Approve answers the first option, Reject the second", () => {
		expect(answerOfAction("approve", data)).toEqual({
			runId: "run-1",
			stepId: "review",
			choice: "ship",
		});
		expect(answerOfAction("reject", data)).toEqual({
			runId: "run-1",
			stepId: "review",
			choice: "hold",
		});
	});

	test("a tap on the notification is no answer", () => {
		expect(
			answerOfAction("expo.modules.notifications.actions.DEFAULT", data),
		).toBeNull();
	});

	test("a Gate without two options is no answer", () => {
		expect(answerOfAction("approve", pushDataOf(plainGate))).toBeNull();
		expect(answerOfAction("approve", null)).toBeNull();
	});

	test("a run's end is no answer, even with options", () => {
		const run = pushDataOf({
			...lockScreenGate,
			kind: "run-finished",
			key: "run-1:end:7",
		});
		expect(answerOfAction("approve", run)).toBeNull();
	});
});

describe("withdraw", () => {
	test("finds the data in the background task's payload on each platform", () => {
		const fields = { withdraw: "run-1:review" };
		// iOS: the Expo body as a JSON string, and as `body`.
		expect(
			taskDataOf({
				data: { dataString: JSON.stringify(fields), body: fields },
				notification: null,
			}),
		).toEqual(fields);
		expect(taskDataOf({ data: { body: fields } })).toEqual(fields);
		// Android: only the JSON string.
		expect(
			taskDataOf({ data: { dataString: JSON.stringify(fields) } }),
		).toEqual(fields);
		expect(taskDataOf({ data: fields })).toEqual(fields);
		expect(taskDataOf(undefined)).toBeNull();
	});

	test("a broken JSON string falls back to the other fields", () => {
		expect(
			withdrawKeyOf(taskDataOf({ data: { dataString: "{", withdraw: "k" } })),
		).toBe("k");
	});

	test("dismisses every shown notification of the key, and only those", () => {
		const shown = [
			{ id: "n1", key: "run-1:review", at: 0 },
			{ id: "n2", key: "run-2:review", at: 0 },
			{ id: "n3", key: "run-1:review", at: 0 },
			{ id: "n4", key: null, at: 0 },
		];
		expect(shownWithKey(shown, "run-1:review")).toEqual(["n1", "n3"]);
		expect(shownWithKey(shown, "run-9:review")).toEqual([]);
	});
});

describe("when a notification came", () => {
	test("iOS seconds and Android milliseconds both become milliseconds", () => {
		expect(shownAtMs(1792624525.675)).toBe(1792624525675);
		expect(shownAtMs(1792624525675)).toBe(1792624525675);
	});
});

describe("a push while the app is in front", () => {
	const gate = pushDataOf(plainGate);

	test("a Gate shows as a banner on any other screen", () => {
		expect(showInFront(gate, { pathname: "/runs" })).toBe(true);
		expect(showInFront(gate, { pathname: "/gates/run-2/review" })).toBe(true);
	});

	test("no banner on the inbox, or on that Gate", () => {
		expect(showInFront(gate, { pathname: "/" })).toBe(false);
		expect(showInFront(gate, { pathname: "/gates/run-1/review" })).toBe(false);
	});

	test("the end of quiet hours shows, except on the inbox", () => {
		const waiting = pushDataOf({ kind: "gates-waiting", key: "waiting:5" });
		expect(showInFront(waiting, { pathname: "/settings" })).toBe(true);
		expect(showInFront(waiting, { pathname: "/" })).toBe(false);
	});

	test("a run's end shows no banner", () => {
		const run = pushDataOf({
			kind: "run-failed",
			key: "run-1:end:7",
			runId: "run-1",
		});
		expect(showInFront(run, { pathname: "/runs" })).toBe(false);
		expect(showInFront(null, { pathname: "/runs" })).toBe(false);
	});
});

describe("where a tap goes", () => {
	const screenOf = (raw: unknown) => {
		const data = pushDataOf(raw);
		return data ? phoneRouteOf(routeOf(data)) : null;
	};

	test("a Gate opens the Gate", () => {
		expect(screenOf(lockScreenGate)).toEqual({
			pathname: "/gates/[runId]/[stepId]",
			params: { runId: "run-1", stepId: "review" },
		});
	});

	test("a run's end opens the run", () => {
		expect(
			screenOf({ kind: "run-finished", key: "r:end:1", runId: "run-1" }),
		).toEqual({ pathname: "/runs/[runId]", params: { runId: "run-1" } });
	});

	test("the end of quiet hours, or a run's end without its run, opens the inbox", () => {
		expect(screenOf({ kind: "gates-waiting", key: "waiting:5" })).toEqual({
			pathname: "/",
		});
		expect(screenOf({ kind: "run-failed", key: "r:end:1" })).toEqual({
			pathname: "/",
		});
	});

	test("a push that is not the Host's goes nowhere", () => {
		expect(screenOf({ withdraw: "run-1:review" })).toBeNull();
	});
});

describe("the permission", () => {
	test("not chosen yet: ask", () => {
		expect(permissionOf({ granted: false, canAskAgain: true })).toBe("ask");
	});

	test("allowed, or delivered quietly on iOS: on", () => {
		expect(permissionOf({ granted: true, canAskAgain: true })).toBe("on");
		expect(
			permissionOf({ granted: false, canAskAgain: false, iosStatus: 3 }),
		).toBe("on");
	});

	test("refused: off, only the Settings app can change it", () => {
		expect(
			permissionOf({ granted: false, canAskAgain: false, iosStatus: 1 }),
		).toBe("off");
	});
});
