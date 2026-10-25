import { describe, expect, test } from "bun:test";
import { type CopyStamp, copyStamps, stampHolds } from "./copy-stamp";
import type { LoggedEvent } from "./events";

/**
 * The stamp of a copy of a step's file: which opening of the step, and
 * whether it had ended. A reader keeps a copy only when its stamp holds
 * the step as the reader's log says.
 */

/** The stamp of one step of a run's events. */
const copyStampOf = (events: readonly LoggedEvent[], stepId: string) =>
	copyStamps(events).get(stepId) ?? null;

/** A step's lifecycle events, in `seq` order from 1. */
function events(
	...types: readonly (
		| "StepStarted"
		| "StepReopened"
		| "StepEnded"
		| "GateOpened"
	)[]
): LoggedEvent[] {
	return types.map(
		(type, i) =>
			({
				seq: i + 1,
				runId: "run-1",
				stepId: "step-1",
				sessionId: null,
				type,
				payload: {},
				at: 0,
			}) as unknown as LoggedEvent,
	);
}

const at = (opening: number, ended: boolean): CopyStamp => ({
	opening,
	ended,
});

describe("the stamp of a step", () => {
	test("counts the step's openings, and says whether the latest ended", () => {
		expect(copyStampOf(events("StepStarted"), "step-1")).toEqual(at(1, false));
		expect(
			copyStampOf(events("StepStarted", "GateOpened", "StepEnded"), "step-1"),
		).toEqual(at(1, true));
		expect(
			copyStampOf(events("StepStarted", "StepEnded", "StepReopened"), "step-1"),
		).toEqual(at(2, false));
		expect(
			copyStampOf(
				events("StepStarted", "StepEnded", "StepReopened", "StepEnded"),
				"step-1",
			),
		).toEqual(at(2, true));
	});

	test("stamps every step of the run in one pass", () => {
		const first = events("StepStarted", "StepEnded");
		const second = events("StepStarted", "StepEnded", "StepReopened").map(
			(e) => ({ ...e, seq: e.seq + first.length, stepId: "step-2" }),
		);
		expect(copyStamps([...first, ...second])).toEqual(
			new Map([
				["step-1", at(1, true)],
				["step-2", at(2, false)],
			]),
		);
	});

	test("is null for a step the events do not start", () => {
		expect(copyStampOf(events("StepStarted"), "step-2")).toBeNull();
		expect(
			copyStampOf(events("StepReopened", "StepEnded"), "step-1"),
		).toBeNull();
	});
});

describe("a copy", () => {
	test("holds the step when it is of the same end", () => {
		expect(stampHolds(at(2, true), at(2, true))).toBe(true);
		expect(stampHolds(at(1, false), at(1, false))).toBe(true);
	});

	test("of an earlier end, or taken while the step ran, does not hold a step that ended", () => {
		expect(stampHolds(at(1, true), at(2, true))).toBe(false);
		expect(stampHolds(at(2, false), at(2, true))).toBe(false);
		// Nor one of a later opening: the reader learns of the reopen first.
		expect(stampHolds(at(2, true), at(1, true))).toBe(false);
	});

	test("of an end the reader does not know of yet holds the opening it knows runs", () => {
		expect(stampHolds(at(1, true), at(1, false))).toBe(true);
	});

	test("without a stamp, from a peer of an older version, holds as it did before", () => {
		expect(stampHolds(undefined, at(2, true))).toBe(true);
		expect(stampHolds(undefined, null)).toBe(true);
	});

	test("with a stamp holds nothing for a reader that lacks the step", () => {
		expect(stampHolds(at(1, true), null)).toBe(false);
	});
});
