/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
	answerOfAction,
	buttonAnswerCheck,
	type PushData,
	permissionOf,
	pushDataOf,
	routeOf,
	showInFront,
	shownAtMs,
	shownButClosed,
	shownWithKey,
	taskDataOf,
	withdrawKeyOf,
} from "./push-data";

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

const plainGate = { ...lockScreenGate, options: undefined };

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

	test("the end of quiet hours has no run", () => {
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
		});
	});
});

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
	test("reads the key of a withdraw push, nothing else", () => {
		expect(withdrawKeyOf({ withdraw: "run-1:review" })).toBe("run-1:review");
		expect(withdrawKeyOf(lockScreenGate)).toBeNull();
		expect(withdrawKeyOf({ withdraw: "" })).toBeNull();
		expect(withdrawKeyOf(undefined)).toBeNull();
	});

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

describe("Gates that no longer wait", () => {
	const READ_AT = 1_000_000;
	const old = READ_AT - 60_000;

	test("a shown Gate the inbox no longer has goes", () => {
		const shown = [
			{ id: "n1", key: "run-1:review", at: old },
			{ id: "n2", key: "run-2:review", at: old },
		];
		expect(shownButClosed(shown, new Set(["run-2:review"]), READ_AT)).toEqual([
			"n1",
		]);
	});

	test("a run's end, the end of quiet hours and other notifications stay", () => {
		const shown = [
			{ id: "n1", key: "run-1:end:7", at: old },
			{ id: "n2", key: "waiting:5", at: old },
			{ id: "n3", key: null, at: old },
		];
		expect(shownButClosed(shown, new Set(), READ_AT)).toEqual([]);
	});

	test("a push newer than the read stays: the read may not know its Gate yet", () => {
		const shown = [{ id: "n1", key: "run-1:review", at: READ_AT - 5_000 }];
		expect(shownButClosed(shown, new Set(), READ_AT)).toEqual([]);
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
	test("a Gate opens the Gate", () => {
		expect(routeOf(pushDataOf(lockScreenGate))).toEqual({
			pathname: "/gates/[runId]/[stepId]",
			params: { runId: "run-1", stepId: "review" },
		});
	});

	test("a run's end opens the run", () => {
		expect(
			routeOf(
				pushDataOf({ kind: "run-finished", key: "r:end:1", runId: "run-1" }),
			),
		).toEqual({ pathname: "/runs/[runId]", params: { runId: "run-1" } });
	});

	test("the end of quiet hours opens the inbox", () => {
		expect(
			routeOf(pushDataOf({ kind: "gates-waiting", key: "waiting:5" })),
		).toEqual({ pathname: "/" });
	});

	test("a push that is not the Host's goes nowhere", () => {
		expect(routeOf(null)).toBeNull();
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

describe("an answer from a lock-screen button", () => {
	const answer = { runId: "run-1", stepId: "review", choice: "ship" };
	const gate = {
		runId: "run-1",
		stepId: "review",
		lockScreen: true,
		choices: [{ name: "ship" }, { name: "hold" }],
	};

	test("goes to an open Gate its author marked for the lock screen", () => {
		expect(buttonAnswerCheck(answer, [gate])).toBe("send");
	});

	test("does nothing for a Gate that no longer waits", () => {
		expect(buttonAnswerCheck(answer, [])).toBe("closed");
		expect(buttonAnswerCheck(answer, [{ ...gate, stepId: "other-step" }])).toBe(
			"closed",
		);
	});

	test("needs the app for any other Gate, whatever the push said", () => {
		// A push can name any Gate and any choice: the Host's list decides.
		expect(buttonAnswerCheck(answer, [{ ...gate, lockScreen: false }])).toBe(
			"open-app",
		);
		expect(
			buttonAnswerCheck({ ...answer, choice: "approve-deploy" }, [gate]),
		).toBe("open-app");
	});
});
