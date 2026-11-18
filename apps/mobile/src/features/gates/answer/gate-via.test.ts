/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { PHONE_VIA, phoneGateAnswer } from "./gate-via";

describe("an answer from the phone app", () => {
	test("says it came from the phone", () => {
		expect(
			phoneGateAnswer({
				runId: "run-1",
				stepId: "step-1",
				choice: "ship",
				note: "Use Postgres.",
			}),
		).toEqual({
			runId: "run-1",
			stepId: "step-1",
			choice: "ship",
			note: "Use Postgres.",
			via: "phone",
		});
		expect(PHONE_VIA).toBe("phone");
	});

	test("keeps an Ask's form", () => {
		expect(
			phoneGateAnswer({
				runId: "run-1",
				stepId: "step-1",
				choice: "answer",
				data: { ok: true },
			}).via,
		).toBe("phone");
	});
});
