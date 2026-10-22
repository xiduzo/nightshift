import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import {
	isHostUnreachable,
	isSignInRequired,
	isTwoFactorRequired,
} from "./refusals";

describe("the refusal of a call without a session", () => {
	test("is told apart from other errors", () => {
		expect(
			isSignInRequired(
				new ORPCError("UNAUTHORIZED", {
					message: "Sign in to use Night Shift.",
				}),
			),
		).toBe(true);
		expect(isSignInRequired({ code: "UNAUTHORIZED", status: 401 })).toBe(true);
		expect(isSignInRequired({ code: "TWO_FACTOR_REQUIRED" })).toBe(false);
		expect(isSignInRequired({ code: "FORBIDDEN" })).toBe(false);
		expect(isSignInRequired(new Error("Sign in to use Night Shift."))).toBe(
			false,
		);
		expect(isSignInRequired(null)).toBe(false);
	});
});

describe("the refusal of a session without two-factor", () => {
	test("the daemon's refusal of a session without two-factor", () => {
		expect(isTwoFactorRequired({ code: "TWO_FACTOR_REQUIRED" })).toBe(true);
		expect(isTwoFactorRequired({ code: "UNAUTHORIZED" })).toBe(false);
		expect(isTwoFactorRequired(null)).toBe(false);
	});
});

describe("the refusal of an action while the Host cannot be reached", () => {
	test("is told apart from other errors", () => {
		expect(
			isHostUnreachable(
				new ORPCError("HOST_UNREACHABLE", {
					status: 503,
					message: "The computer that keeps this Space cannot be reached.",
				}),
			),
		).toBe(true);
		expect(isHostUnreachable({ code: "BAD_REQUEST" })).toBe(false);
		expect(isHostUnreachable(new TypeError("Failed to fetch"))).toBe(false);
		expect(isHostUnreachable(null)).toBe(false);
	});
});
