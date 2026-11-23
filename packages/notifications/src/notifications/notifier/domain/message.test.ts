import { describe, expect, test } from "bun:test";
import {
	claimOf,
	gateFactsOf,
	gatesWaitingMessage,
	keptWords,
	noticeMessage,
	pushMessageOf,
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

describe("the message of a push", () => {
	const marked = { lockScreen: true, choices: ["ship"] };

	test("a Gate's carries what its notification may show; only a marked Gate asks who may answer", async () => {
		const asked: string[] = [];
		const mayAnswer = async (spaceId: string, personId: string) => {
			asked.push(`${spaceId}:${personId}`);
			return true;
		};
		const gate = { kind: "gate-opened" as const, key: "run-1:step-1", ids };
		expect(
			await pushMessageOf(
				{ ...gate, personId: "ada" },
				5,
				() => marked,
				mayAnswer,
			),
		).toMatchObject({
			alert: true,
			at: 5,
			gate: { lockScreen: true, options: [{ id: "ship", label: "ship" }] },
		});
		expect(
			await pushMessageOf(
				{ ...gate, personId: "bob" },
				5,
				() => undefined,
				mayAnswer,
			),
		).toMatchObject({ gate: { lockScreen: false, options: [] } });
		expect(asked).toEqual(["space-1:ada"]);
	});

	test("a run's end carries no Gate, and says the words it was given", async () => {
		const message = await pushMessageOf(
			{
				kind: "device-wait",
				key: "run-1:wait:step-1",
				ids,
				personId: "ada",
				words: { title: "Triage waits for studio-mac" },
			},
			5,
			() => marked,
			async () => true,
		);
		expect(message).not.toHaveProperty("gate");
		expect(message.title).toBe("Triage waits for studio-mac");
	});
});
