/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { answerCheck, CHECK_COPY, checkFailure } from "./answer-check";

describe("answerCheck", () => {
	test("a lock-screen Gate is sent at once, whatever the phone's lock", () => {
		expect(answerCheck({ lockScreen: true }, "biometric")).toBe("send");
		expect(answerCheck({ lockScreen: true }, "passcode")).toBe("send");
		expect(answerCheck({ lockScreen: true }, "none")).toBe("send");
	});

	test("any other Gate needs Face ID, a fingerprint or the passcode", () => {
		expect(answerCheck({ lockScreen: false }, "biometric")).toBe("check");
		expect(answerCheck({ lockScreen: false }, "passcode")).toBe("check");
	});

	test("a phone without a lock cannot answer it", () => {
		expect(answerCheck({ lockScreen: false }, "none")).toBe("not-set-up");
	});
});

describe("checkFailure", () => {
	test("the person or the phone cancelled", () => {
		for (const error of [
			"user_cancel",
			"system_cancel",
			"app_cancel",
			"user_fallback",
		]) {
			expect(checkFailure(error)).toBe("cancelled");
		}
	});

	test("the phone has no lock", () => {
		for (const error of ["not_enrolled", "not_available", "passcode_not_set"]) {
			expect(checkFailure(error)).toBe("not-set-up");
		}
	});

	test("too many tries, and anything else", () => {
		expect(checkFailure("lockout")).toBe("locked-out");
		expect(checkFailure("authentication_failed")).toBe("failed");
		expect(checkFailure("something new")).toBe("failed");
	});

	test("every failure has words for the person", () => {
		for (const copy of Object.values(CHECK_COPY)) {
			expect(copy.title.length).toBeGreaterThan(0);
			expect(copy.description).not.toContain(";");
		}
	});
});
