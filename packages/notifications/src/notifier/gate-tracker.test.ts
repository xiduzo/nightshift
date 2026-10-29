import { describe, expect, test } from "bun:test";
import type { LandedFact } from "@nightshift/engine";

import { createGateTracker } from "./gate-tracker";
import type { OpenGateRef } from "./sources";

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

const base = (runId: string) => ({
	spaceId: SPACE,
	runId,
	seq: 1,
	changes: "summary" as const,
});
const gateOpened = (runId: string, stepId: string): LandedFact => ({
	...base(runId),
	kind: "gate-opened",
	stepId,
});
const stepEnded = (runId: string, stepId = "step"): LandedFact => ({
	...base(runId),
	kind: "step-ended",
	stepId,
});

describe("the gate tracker", () => {
	test("a Gate that opens in the batch opens, with what the engine says of it", async () => {
		const { tracker, set } = engine();
		const review = { runId: "r1", stepId: "review", lockScreen: true };
		set([review]);
		expect(await tracker.apply(SPACE, [gateOpened("r1", "review")])).toEqual({
			opened: [{ key: "r1:review", runId: "r1", stepId: "review" }],
			closed: [],
		});
		expect(tracker.isOpen(SPACE, "r1:review")).toBe(true);
		expect(tracker.factsOf(SPACE, "r1:review")).toEqual(review);
		// The same fact again opens nothing new.
		expect(
			(await tracker.apply(SPACE, [gateOpened("r1", "review")])).opened,
		).toEqual([]);
	});

	test("a known Gate missing from the read closes", async () => {
		const { tracker, set } = engine([{ runId: "r1", stepId: "review" }]);
		await tracker.baseline([SPACE]);
		set([]);
		expect(await tracker.apply(SPACE, [stepEnded("r1")])).toEqual({
			opened: [],
			closed: ["r1:review"],
		});
		expect(tracker.isOpen(SPACE, "r1:review")).toBe(false);
	});

	test("a fact of a run without a known Gate, and no Gate that opened, reads nothing", async () => {
		const { tracker, reads } = engine([{ runId: "r1", stepId: "review" }]);
		await tracker.baseline([SPACE]);
		expect(reads()).toBe(1);
		expect(await tracker.apply(SPACE, [stepEnded("r2")])).toEqual({
			opened: [],
			closed: [],
		});
		expect(reads()).toBe(1);
	});

	test("a Gate a read shows before its fact is told when the fact comes", async () => {
		const { tracker, set } = engine([{ runId: "r1", stepId: "review" }]);
		await tracker.baseline([SPACE]);
		set([
			{ runId: "r1", stepId: "review" },
			{ runId: "r2", stepId: "ship" },
		]);
		expect((await tracker.apply(SPACE, [stepEnded("r1")])).opened).toEqual([]);
		expect(
			(await tracker.apply(SPACE, [gateOpened("r2", "ship")])).opened,
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
