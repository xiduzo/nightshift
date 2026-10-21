/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { targetKeyOf, withRetry } from "./retry";

/** A wait that records how long it would wait, and waits for nothing. */
function fakeWait() {
	const waits: number[] = [];
	return {
		waits,
		wait: async (ms: number) => {
			waits.push(ms);
		},
	};
}

describe("registration retry", () => {
	test("the first try that works is the result", async () => {
		const { wait, waits } = fakeWait();
		let tries = 0;
		const result = await withRetry(
			async () => {
				tries += 1;
				if (tries < 3) throw new Error("offline");
				return "target-1";
			},
			{ signal: new AbortController().signal, wait },
		);
		expect(result).toBe("target-1");
		expect(tries).toBe(3);
		expect(waits).toEqual([1000, 2000]);
	});

	test("gives up after the last try, without a wait after it", async () => {
		const { wait, waits } = fakeWait();
		const errors: number[] = [];
		const result = await withRetry(
			async () => {
				throw new Error("offline");
			},
			{
				signal: new AbortController().signal,
				wait,
				tries: 3,
				delay: (n) => n * 10,
				onError: (_error, attempt) => errors.push(attempt),
			},
		);
		expect(result).toBeNull();
		expect(errors).toEqual([0, 1, 2]);
		expect(waits).toEqual([0, 10]);
	});

	test("stops when the signal aborts: signed out, or the app left", async () => {
		const controller = new AbortController();
		let tries = 0;
		const result = await withRetry(
			async () => {
				tries += 1;
				throw new Error("offline");
			},
			{
				signal: controller.signal,
				wait: async () => controller.abort(),
			},
		);
		expect(result).toBeNull();
		expect(tries).toBe(1);
	});
});

describe("the kept target id", () => {
	test("one key per Host, with only the characters SecureStore takes", () => {
		expect(targetKeyOf("https://studio.example.com:8443")).toBe(
			"nightshift.push-target.https___studio_example_com_8443",
		);
		expect(targetKeyOf("https://a.example.com")).not.toBe(
			targetKeyOf("https://b.example.com"),
		);
	});
});
