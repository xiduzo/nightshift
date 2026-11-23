import { describe, expect, test } from "bun:test";
import {
	createPendingPairings,
	normalizeUserCode,
	pendingByUserCode,
	prunePending,
} from "./pending";

describe("pending pairings", () => {
	test("a hyphenated code and its letters are one code", () => {
		expect(normalizeUserCode("ab-cd")).toBe("ABCD");
		expect(normalizeUserCode("ABCD")).toBe("ABCD");
	});

	test("prune drops only codes whose time has passed", () => {
		const pending = createPendingPairings();
		pending.set("live", {
			deviceId: "a",
			name: "A",
			platform: "darwin",
			userCode: "AAAA",
			expiresAt: 10,
		});
		pending.set("old", {
			deviceId: "b",
			name: "B",
			platform: "darwin",
			userCode: "BBBB",
			expiresAt: 5,
		});
		prunePending(pending, 8);
		expect([...pending.keys()]).toEqual(["live"]);
	});

	test("a review finds the Device by the Person's user code", () => {
		const pending = createPendingPairings();
		pending.set("device-code", {
			deviceId: "laptop",
			name: "LE2316",
			platform: "darwin",
			home: true,
			userCode: "ABCD",
			expiresAt: 99,
		});
		expect(pendingByUserCode(pending, "abcd")?.name).toBe("LE2316");
		expect(pendingByUserCode(pending, "nope")).toBeUndefined();
	});
});
