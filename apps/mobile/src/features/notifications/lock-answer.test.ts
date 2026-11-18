/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { LOCK_SCREEN_VIA, lockScreenAnswer } from "./lock-answer";

describe("an answer from the lock screen", () => {
	test("stays bound to the run and the step, and says it came from the lock screen", () => {
		expect(
			lockScreenAnswer({
				runId: "run-1",
				stepId: "review",
				choice: "ship",
			}),
		).toEqual({
			runId: "run-1",
			stepId: "review",
			choice: "ship",
			via: "lock_screen",
		});
		expect(LOCK_SCREEN_VIA).toBe("lock_screen");
	});
});
