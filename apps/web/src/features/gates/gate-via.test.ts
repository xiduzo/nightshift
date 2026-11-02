import { describe, expect, test } from "bun:test";

import { WEB_VIA, webGateAnswer } from "./gate-via";

describe("an answer from the web app", () => {
	test("says it came from the web", () => {
		expect(
			webGateAnswer({
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
			via: "web",
		});
		expect(WEB_VIA).toBe("web");
	});

	test("keeps an Ask's form and replaces any other place", () => {
		expect(
			webGateAnswer({
				runId: "run-1",
				stepId: "step-1",
				choice: "answer",
				data: { ok: true },
				via: "phone",
			}),
		).toEqual({
			runId: "run-1",
			stepId: "step-1",
			choice: "answer",
			data: { ok: true },
			via: "web",
		});
	});
});
