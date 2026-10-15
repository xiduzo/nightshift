import { describe, expect, test } from "bun:test";

import {
	deriveRunStatus,
	type EnginePayloads,
	type LoggedEvent,
	openSessions,
	type SessionOutcome,
	sumCostUsd,
} from "./events";

let seq = 0;
const started = (sessionId: string): LoggedEvent => ({
	seq: ++seq,
	runId: "run-1",
	sessionId,
	type: "SessionStarted",
	payload: { prompt: "p", resumeSessionId: null, transcriptPath: "/t" },
	at: 0,
});
const ended = (
	sessionId: string,
	outcome: SessionOutcome,
	costUsd: number | null = null,
): LoggedEvent => {
	const payload: EnginePayloads["SessionEnded"] = {
		outcome,
		error: null,
		errorKind: null,
		usage: null,
		costUsd,
		resetAt: null,
	};
	return {
		seq: ++seq,
		runId: "run-1",
		sessionId,
		type: "SessionEnded",
		payload,
		at: 0,
	};
};

describe("deriveRunStatus", () => {
	test("a run without a session is interrupted", () => {
		expect(deriveRunStatus([])).toBe("interrupted");
	});

	test("a started session without an end is running", () => {
		expect(deriveRunStatus([started("a")])).toBe("running");
	});

	test("the status is the outcome of the latest session", () => {
		for (const outcome of [
			"finished",
			"stopped",
			"failed",
			"interrupted",
		] as const) {
			expect(deriveRunStatus([started("a"), ended("a", outcome)])).toBe(
				outcome,
			);
		}
	});

	test("a resumed session decides the status, not the earlier one", () => {
		expect(
			deriveRunStatus([started("a"), ended("a", "stopped"), started("b")]),
		).toBe("running");
		expect(
			deriveRunStatus([
				started("a"),
				ended("a", "stopped"),
				started("b"),
				ended("b", "finished"),
			]),
		).toBe("finished");
	});

	test("the first end of a session wins over a late duplicate", () => {
		expect(
			deriveRunStatus([
				started("a"),
				ended("a", "interrupted"),
				ended("a", "stopped"),
			]),
		).toBe("interrupted");
	});
});

test("sumCostUsd adds the cost of each ended session once", () => {
	expect(
		sumCostUsd([
			started("a"),
			ended("a", "finished", 0.25),
			started("b"),
			ended("b", "failed"),
			started("c"),
			ended("c", "finished", 0.5),
			ended("c", "finished", 9),
		]),
	).toBe(0.75);
});

test("openSessions lists sessions that started but never ended", () => {
	expect(
		openSessions([started("a"), ended("a", "finished"), started("b")]),
	).toEqual([{ runId: "run-1", sessionId: "b" }]);
});
