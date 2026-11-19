import { describe, expect, test } from "bun:test";
import { RunRefusal } from "../../../run-status";
import {
	NOT_WAITING,
	type ProjectSignal,
	refuseUnlessWaiting,
	type SignalSleep,
	takes,
	waitsFor,
} from "./signal-match";

/** Which sleep a webhook's signal wakes (ADR 8). */

const signal = (overrides: Partial<ProjectSignal> = {}): ProjectSignal => ({
	name: "deployed",
	key: null,
	data: { env: "prod" },
	...overrides,
});

const sleep = (overrides: Partial<SignalSleep> = {}): SignalSleep => ({
	signal: "deployed",
	signalKey: null,
	signalRules: [],
	...overrides,
});

describe("waitsFor", () => {
	test("a sleep on the signal's name, with no key, waits for it", () => {
		expect(waitsFor(sleep(), signal())).toBe(true);
	});

	test("another name, or no sleep, does not", () => {
		expect(waitsFor(sleep({ signal: "merged" }), signal())).toBe(false);
		expect(waitsFor(sleep({ signal: null }), signal())).toBe(false);
		expect(waitsFor(null, signal())).toBe(false);
	});

	test("a sleep with a key waits only for a signal with that key", () => {
		expect(
			waitsFor(sleep({ signalKey: "pr-7" }), signal({ key: "pr-7" })),
		).toBe(true);
		expect(
			waitsFor(sleep({ signalKey: "pr-7" }), signal({ key: "pr-8" })),
		).toBe(false);
		expect(waitsFor(sleep({ signalKey: "pr-7" }), signal())).toBe(false);
	});
});

describe("takes", () => {
	test("a sleep with no rules takes every signal it waits for", async () => {
		expect(await takes(sleep(), signal())).toBe(true);
		expect(await takes(sleep({ signal: "merged" }), signal())).toBe(false);
		expect(await takes(null, signal())).toBe(false);
	});

	test("a sleep with rules takes a signal only when one of them holds for the event", async () => {
		const rules = [{ outcome: "prod", when: 'event.env = "prod"' }];
		expect(await takes(sleep({ signalRules: rules }), signal())).toBe(true);
		expect(
			await takes(
				sleep({ signalRules: rules }),
				signal({ data: { env: "test" } }),
			),
		).toBe(false);
	});
});

describe("refuseUnlessWaiting", () => {
	test("a run that still waits passes", () => {
		expect(() =>
			refuseUnlessWaiting(signal())({ sleep: sleep() }),
		).not.toThrow();
	});

	test("a run that moved on is refused with wrong-signal", () => {
		let refused: unknown;
		try {
			refuseUnlessWaiting(signal())({ sleep: null });
		} catch (error) {
			refused = error;
		}
		expect(refused).toBeInstanceOf(RunRefusal);
		expect((refused as RunRefusal).rule).toBe("wrong-signal");
		expect((refused as Error).message).toBe(NOT_WAITING);
		expect(NOT_WAITING).toBe("This run does not wait for that signal.");
	});
});
