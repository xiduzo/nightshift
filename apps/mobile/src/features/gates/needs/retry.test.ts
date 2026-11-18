/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { type RetrySend, retryLabel, retryState } from "./retry";

const run = { id: "r1", endedAt: 100 };

function send(fields: Partial<RetrySend>): RetrySend {
	return { runId: "r1", status: "pending", submittedAt: 200, ...fields };
}

describe("retryState", () => {
	test("no tap: the buttons", () => {
		expect(retryState(run, [])).toBeNull();
		expect(retryState(run, [send({ runId: "other" })])).toBeNull();
	});

	test("on its way, then taken", () => {
		expect(retryState(run, [send({})])).toBe("sending");
		expect(retryState(run, [send({ status: "success" })])).toBe("sent");
	});

	test("a tap that failed brings the buttons back", () => {
		expect(retryState(run, [send({ status: "error" })])).toBeNull();
	});

	test("the newest tap counts", () => {
		expect(
			retryState(run, [
				send({ status: "error", submittedAt: 300 }),
				send({ status: "success", submittedAt: 200 }),
			]),
		).toBeNull();
	});

	test("a run that stopped again after the tap shows its buttons", () => {
		expect(
			retryState({ id: "r1", endedAt: 500 }, [send({ status: "success" })]),
		).toBeNull();
	});
});

describe("retryLabel", () => {
	test("Retry a run that failed, Resume one that stopped", () => {
		expect(retryLabel("failed")).toBe("Retry");
		expect(retryLabel("stopped")).toBe("Resume");
		expect(retryLabel("interrupted")).toBe("Resume");
	});
});
