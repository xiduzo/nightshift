import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	NOT_YOURS,
	normalizeUserCode,
	pairingRefusalOf,
	waitingAnswer,
} from "./pairing";

const oauth = (error: string, description = "") => ({
	status: "BAD_REQUEST",
	body: { error, error_description: description },
});

describe("normalizeUserCode", () => {
	test("a dash and lower case are the same code", () => {
		expect(normalizeUserCode("abcd-efgh")).toBe("ABCDEFGH");
	});
});

describe("waitingAnswer", () => {
	test("each OAuth code of a poll is an answer, any other is not valid", () => {
		expect(waitingAnswer("authorization_pending")).toEqual({
			status: "pending",
		});
		expect(waitingAnswer("slow_down")).toEqual({ status: "slow-down" });
		expect(waitingAnswer("access_denied")).toEqual({ status: "denied" });
		expect(waitingAnswer("expired_token")).toEqual({ status: "expired" });
		expect(() => waitingAnswer(null)).toThrow(
			new Refusal(
				"invalid",
				"This pairing code is not valid. Start the pairing again.",
			),
		);
	});
});

describe("pairingRefusalOf", () => {
	test("each refusal of the plugin gets the words of the Person approving", () => {
		const words = (error: unknown) => {
			const refusal = pairingRefusalOf(error) as Refusal;
			return [refusal.kind, refusal.message];
		};
		expect(words({ status: "UNAUTHORIZED" })).toEqual([
			"signed-out",
			"Sign in to approve a device.",
		]);
		expect(words({ status: "FORBIDDEN" })).toEqual(["forbidden", NOT_YOURS]);
		expect(words(oauth("invalid_request", "Already processed"))).toEqual([
			"conflict",
			"Someone used this code already. Start the pairing again on the device.",
		]);
		expect(words(oauth("invalid_request", "Not claimed"))).toEqual([
			"invalid",
			"Enter the code first, then approve it.",
		]);
		expect(words(oauth("invalid_request"))).toEqual([
			"not-found",
			"No device waits with this code. Check the code and try again.",
		]);
		expect(words(oauth("expired_token"))).toEqual([
			"conflict",
			"This code expired. Start the pairing again on the device.",
		]);
		expect(words(oauth("access_denied"))).toEqual(["forbidden", NOT_YOURS]);
	});

	test("any other error stays a failure", () => {
		const failure = new Error("disk full");
		expect(pairingRefusalOf(failure)).toBe(failure);
	});
});
