import { describe, expect, test } from "bun:test";

import type { RunEvent } from "./sources";
import { createWaitTracker } from "./wait-tracker";

const SPACE = "space-1";
let seq = 0;

function event(
	type: string,
	stepId: string | null = "step-1",
	payload: unknown = {},
	runId = "run-1",
): RunEvent {
	seq += 1;
	return { spaceId: SPACE, runId, stepId, type, seq, payload };
}

const offline = (stepId = "step-1", deviceName: unknown = "studio-mac") =>
	event("WaitStarted", stepId, {
		reason: "device-offline",
		deviceId: "device-2",
		deviceName,
	});

describe("the device waits", () => {
	test("a step that sleeps for its Device starts one wait, also when it looks again", () => {
		const waits = createWaitTracker(10_000);
		expect(waits.apply(SPACE, [offline()], 0)).toEqual({
			started: [
				{
					key: "run-1:wait:step-1",
					runId: "run-1",
					stepId: "step-1",
					deviceName: "studio-mac",
				},
			],
			ended: [],
		});
		expect(waits.apply(SPACE, [event("WaitEnded"), offline()], 60_000)).toEqual(
			{ started: [], ended: [] },
		);
		expect(waits.due(1_000_000)).toEqual([]);
	});

	test("a wait is over once its step stays awake past the grace", () => {
		const waits = createWaitTracker(10_000);
		waits.apply(SPACE, [offline()], 0);
		waits.apply(SPACE, [event("WaitEnded")], 1_000);
		expect(waits.due(10_999)).toEqual([]);
		expect(waits.due(11_000)).toEqual([
			{ spaceId: SPACE, key: "run-1:wait:step-1" },
		]);
		expect(waits.due(20_000)).toEqual([]);
	});

	test("a wait is over at once when its step ends, its run ends, or the step waits for something else", () => {
		const waits = createWaitTracker();
		waits.apply(SPACE, [offline("a"), offline("b"), offline("c")], 0);
		expect(waits.apply(SPACE, [event("StepEnded", "a")], 1).ended).toEqual([
			"run-1:wait:a",
		]);
		expect(
			waits.apply(
				SPACE,
				[event("WaitStarted", "b", { reason: "usage-limit" })],
				2,
			).ended,
		).toEqual(["run-1:wait:b"]);
		expect(
			waits.apply(SPACE, [event("RunEnded", null, { status: "stopped" })], 3)
				.ended,
		).toEqual(["run-1:wait:c"]);
	});

	test("a wait that starts and ends in one batch tells nobody", () => {
		const waits = createWaitTracker();
		expect(waits.apply(SPACE, [offline(), event("StepEnded")], 0)).toEqual({
			started: [],
			ended: [],
		});
	});

	test("a Walker of an older version names no Device", () => {
		const waits = createWaitTracker();
		const { started } = waits.apply(SPACE, [offline("a", null)], 0);
		expect(started[0]?.deviceName).toBeNull();
	});

	test("a wait known from before a restart ends like any other", () => {
		const waits = createWaitTracker(10_000);
		waits.track(SPACE, "run-1:wait:step-1");
		waits.track(SPACE, "run-1:step-1");
		expect(waits.apply(SPACE, [offline()], 0).started).toEqual([]);
		expect(waits.apply(SPACE, [event("StepEnded")], 1).ended).toEqual([
			"run-1:wait:step-1",
		]);
		expect(waits.apply(SPACE, [event("StepEnded")], 2).ended).toEqual([]);
	});
});
