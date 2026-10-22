import { describe, expect, test } from "bun:test";

import {
	gateKey,
	type NotificationMessage,
	parseGateKey,
	runEndKey,
} from "./channel";
import { EXPO_ANDROID_CHANNEL, EXPO_CATEGORY } from "./expo";

/**
 * The phone push contract, Host side. The phone reads these values from
 * `@nightshift/client` (`notifications/push.ts`), and its `push.test.ts`
 * pins the same ones. A layer below the client cannot import it, so both
 * sides pin the values: a change here breaks the phone's lock-screen
 * buttons, channels and clearing until the client changes too.
 */
describe("the phone push contract", () => {
	test("names the categories and Android channels the phone defines", () => {
		expect(EXPO_CATEGORY).toEqual({
			decide: "gate-decide",
			open: "gate-open",
			run: "run",
		});
		expect(EXPO_ANDROID_CHANNEL).toEqual({ gates: "gates", runs: "runs" });
	});

	test("sends the kinds the phone reads", () => {
		const kinds: Record<NotificationMessage["kind"], true> = {
			"gate-opened": true,
			"run-finished": true,
			"run-failed": true,
			"gates-waiting": true,
		};
		expect(Object.keys(kinds)).toEqual([
			"gate-opened",
			"run-finished",
			"run-failed",
			"gates-waiting",
		]);
	});

	test("keys a Gate by run and step, and a run's end with a third part", () => {
		expect(gateKey("run-1", "review")).toBe("run-1:review");
		expect(parseGateKey("run-1:review")).toEqual({
			runId: "run-1",
			stepId: "review",
		});
		expect(runEndKey("run-1", 7)).toBe("run-1:end:7");
	});
});
