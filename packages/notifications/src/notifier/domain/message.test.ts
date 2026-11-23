import { describe, expect, test } from "bun:test";
import {
	claimOf,
	gateFactsOf,
	gatesWaitingMessage,
	keptWords,
	noticeMessage,
} from "./message";

const ids = { spaceId: "space-1", runId: "run-1", stepId: "step-1" };

describe("the message of one event", () => {
	test("says the sentence of its kind, with its ids and time", () => {
		expect(noticeMessage("gate-opened", "run-1:step-1", ids, true, 5)).toEqual({
			key: "run-1:step-1",
			kind: "gate-opened",
			spaceId: "space-1",
			runId: "run-1",
			stepId: "step-1",
			title: "A Gate waits for you",
			alert: true,
			count: null,
			at: 5,
		});
	});

	test("a missed schedule names no run, and says its own words", () => {
		const message = noticeMessage(
			"schedule-missed",
			"key",
			{ spaceId: "space-1", runId: "", stepId: null },
			false,
			5,
			{ title: "A schedule did not start", body: "Daily was due at 22:30." },
		);
		expect(message.runId).toBeNull();
		expect(message.body).toBe("Daily was due at 22:30.");
	});

	test("a Gate shows its options only when marked and the person may answer", () => {
		const gate = { lockScreen: true, choices: ["yes", "no"] };
		expect(gateFactsOf(gate, true)).toEqual({
			lockScreen: true,
			options: [
				{ id: "yes", label: "yes" },
				{ id: "no", label: "no" },
			],
		});
		const none = { lockScreen: false, options: [] };
		expect(gateFactsOf(gate, false)).toEqual(none);
		expect(gateFactsOf({ lockScreen: false }, true)).toEqual(none);
		expect(gateFactsOf(undefined, true)).toEqual(none);
	});

	test("the end of quiet hours counts the Gates that wait", () => {
		expect(gatesWaitingMessage("waiting:9", 3, 9)).toEqual({
			key: "waiting:9",
			kind: "gates-waiting",
			spaceId: null,
			runId: null,
			stepId: null,
			title: "3 Gates wait for you",
			alert: true,
			count: 3,
			at: 9,
		});
	});

	test("a claim keeps the words a held push says later", () => {
		expect(claimOf("ada", "key", "device-wait", ids, { title: "T" })).toEqual({
			personId: "ada",
			key: "key",
			kind: "device-wait",
			...ids,
			title: "T",
			body: null,
		});
		expect(keptWords({ title: null, body: null })).toBeUndefined();
		expect(keptWords({ title: "T", body: "B" })).toEqual({
			title: "T",
			body: "B",
		});
	});
});
