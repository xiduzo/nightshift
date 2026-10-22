import { describe, expect, test } from "bun:test";

import { createGateTracker } from "./gate-tracker";
import type { OpenGateRef, RunEvent } from "./sources";

const SPACE = "space-1";

/** The engine's open Gates, which a test changes, and how often they were read. */
function engine(initial: OpenGateRef[] = []) {
	let gates = initial;
	let reads = 0;
	const tracker = createGateTracker(async () => {
		reads += 1;
		return gates;
	});
	return {
		tracker,
		set: (next: OpenGateRef[]) => {
			gates = next;
		},
		reads: () => reads,
	};
}

const event = (
	runId: string,
	type: string,
	stepId: string | null = null,
): RunEvent => ({ spaceId: SPACE, runId, stepId, type, seq: 1, payload: {} });

describe("the gate tracker", () => {
	test("a Gate that opens in the batch opens, with what the engine says of it", async () => {
		const { tracker, set } = engine();
		const review = { runId: "r1", stepId: "review", lockScreen: true };
		set([review]);
		expect(
			await tracker.apply(SPACE, [event("r1", "GateOpened", "review")]),
		).toEqual({
			opened: [{ key: "r1:review", runId: "r1", stepId: "review" }],
			closed: [],
		});
		expect(tracker.isOpen(SPACE, "r1:review")).toBe(true);
		expect(tracker.factsOf(SPACE, "r1:review")).toEqual(review);
		// The same event again opens nothing new.
		expect(
			(await tracker.apply(SPACE, [event("r1", "GateOpened", "review")]))
				.opened,
		).toEqual([]);
	});

	test("a known Gate missing from the read closes", async () => {
		const { tracker, set } = engine([{ runId: "r1", stepId: "review" }]);
		await tracker.baseline([SPACE]);
		set([]);
		expect(await tracker.apply(SPACE, [event("r1", "StepEnded")])).toEqual({
			opened: [],
			closed: ["r1:review"],
		});
		expect(tracker.isOpen(SPACE, "r1:review")).toBe(false);
	});

	test("an event of a run without a known Gate, and no GateOpened, reads nothing", async () => {
		const { tracker, reads } = engine([{ runId: "r1", stepId: "review" }]);
		await tracker.baseline([SPACE]);
		expect(reads()).toBe(1);
		expect(await tracker.apply(SPACE, [event("r2", "StepEnded")])).toEqual({
			opened: [],
			closed: [],
		});
		expect(reads()).toBe(1);
	});

	test("a Gate a read shows before its GateOpened is told when the event comes", async () => {
		const { tracker, set } = engine([{ runId: "r1", stepId: "review" }]);
		await tracker.baseline([SPACE]);
		set([
			{ runId: "r1", stepId: "review" },
			{ runId: "r2", stepId: "ship" },
		]);
		expect(
			(await tracker.apply(SPACE, [event("r1", "StepEnded")])).opened,
		).toEqual([]);
		expect(
			(await tracker.apply(SPACE, [event("r2", "GateOpened", "ship")])).opened,
		).toEqual([{ key: "r2:ship", runId: "r2", stepId: "ship" }]);
	});

	test("the baseline knows every open Gate of each Space", async () => {
		const { tracker } = engine([{ runId: "r1", stepId: "review" }]);
		await tracker.baseline([SPACE]);
		expect(tracker.open()).toEqual([
			{ spaceId: SPACE, key: "r1:review", runId: "r1", stepId: "review" },
		]);
	});
});
