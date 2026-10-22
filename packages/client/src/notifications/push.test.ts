import { describe, expect, test } from "bun:test";

import { gateKey } from "../gates";
import {
	isGateKey,
	PUSH_ACTION,
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
	PUSH_MESSAGE_KINDS,
} from "./push";

/**
 * The Host sends these values (`push-contract.test.ts` in
 * `@nightshift/notifications` pins the same ones). A change here is a
 * change of the phone push contract: change both sides.
 */
describe("the phone push contract", () => {
	test("names the categories, channels and kinds the Host sends", () => {
		expect(PUSH_CATEGORY).toEqual({
			decide: "gate-decide",
			open: "gate-open",
			run: "run",
		});
		expect(PUSH_ANDROID_CHANNEL).toEqual({ gates: "gates", runs: "runs" });
		expect(PUSH_ACTION).toEqual({ approve: "approve", reject: "reject" });
		expect([...PUSH_MESSAGE_KINDS]).toEqual([
			"gate-opened",
			"run-finished",
			"run-failed",
			"gates-waiting",
		]);
	});

	test("a Gate's key is its run and step, as the Host keys it", () => {
		const key = gateKey({ runId: "run-1", stepId: "review" });
		expect(key).toBe("run-1:review");
		expect(isGateKey(key)).toBe(true);
	});

	test("a run's end and the end of quiet hours are not Gates", () => {
		expect(isGateKey("run-1:end:7")).toBe(false);
		expect(isGateKey("waiting:1700000000000")).toBe(false);
		expect(isGateKey("run-1")).toBe(false);
		expect(isGateKey(":review")).toBe(false);
	});
});
