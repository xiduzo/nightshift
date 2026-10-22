import { describe, expect, test } from "bun:test";

import type { RunDetail, RunStatus } from "../runs";
import { runProgress, sameProgress } from "./progress";
import { glanceSnapshot, waitingText } from "./snapshot";

const run = (
	id: string,
	status: RunStatus,
	createdAt: number,
	flowName: string | null = "fix-bug",
) => ({ id, status, createdAt, flowName });

describe("the widget's snapshot", () => {
	test("counts only the Gates you may answer", () => {
		const snapshot = glanceSnapshot({
			gates: [{ canAnswer: true }, { canAnswer: false }, { canAnswer: true }],
			runs: [],
		});
		expect(snapshot.waiting).toBe(2);
		expect(snapshot.waitingText).toBe("2 Gates wait for you");
	});

	test("shows the three newest runs with their status, newest first", () => {
		const snapshot = glanceSnapshot({
			gates: [],
			runs: [
				run("a", "finished", 1),
				run("b", "failed", 4, "deploy"),
				run("c", "waiting", 3),
				run("d", "running", 2, null),
			],
		});
		expect(snapshot.runs).toEqual([
			{
				id: "b",
				flow: "deploy",
				status: "failed",
				statusText: "Failed",
				tone: "failed",
			},
			{
				id: "c",
				flow: "fix-bug",
				status: "waiting",
				statusText: "Waiting for you",
				tone: "waiting",
			},
			{
				id: "d",
				flow: "Quick run",
				status: "running",
				statusText: "Running",
				tone: "running",
			},
		]);
	});

	test("holds no run titles or Gate questions", () => {
		const snapshot = glanceSnapshot({
			gates: [{ canAnswer: true, question: "Ship it?" } as never],
			runs: [{ ...run("a", "running", 1), title: "fix-bug · secret" } as never],
		});
		expect(JSON.stringify(snapshot)).not.toContain("Ship it?");
		expect(JSON.stringify(snapshot)).not.toContain("secret");
	});

	test("an interrupted run looks like a stopped one", () => {
		const snapshot = glanceSnapshot({
			gates: [],
			runs: [run("a", "interrupted", 1)],
		});
		expect(snapshot.runs[0]?.tone).toBe("stopped");
		expect(snapshot.runs[0]?.statusText).toBe("Interrupted");
	});

	test("says how many Gates wait in words", () => {
		expect(waitingText(0)).toBe("Nothing waits for you");
		expect(waitingText(1)).toBe("1 Gate waits for you");
		expect(waitingText(5)).toBe("5 Gates wait for you");
	});
});

type Detail = Parameters<typeof runProgress>[0];

const node = (id: string, label = "") => ({ id, label }) as never;
const step = (
	nodeId: string,
	startedAt: number,
	endedAt: number | null,
	extra: Partial<RunDetail["steps"][number]> = {},
) =>
	({
		id: `${nodeId}:${startedAt}`,
		nodeId,
		visit: 1,
		startedAt,
		endedAt,
		scope: null,
		...extra,
	}) as RunDetail["steps"][number];

const detail = (
	status: RunStatus,
	steps: RunDetail["steps"],
	nodes = [node("plan", "Plan"), node("build", "Build"), node("review")],
): Detail =>
	({
		id: "run-1",
		flowName: "feature",
		status,
		steps,
		flow: { nodes },
		calledFlows: {},
	}) as unknown as Detail;

describe("a run's progress on the lock screen", () => {
	test("names the step that runs and counts step x of y", () => {
		const progress = runProgress(
			detail("running", [step("plan", 1, 2), step("build", 3, null)]),
		);
		expect(progress).toEqual({
			runId: "run-1",
			flow: "feature",
			status: "running",
			statusText: "Running",
			tone: "running",
			step: "Build",
			position: "Step 2 of 3",
			fraction: 2 / 3,
			ended: false,
		});
	});

	test("says Starting before the first step", () => {
		const progress = runProgress(detail("running", []));
		expect(progress.position).toBe("Starting");
		expect(progress.step).toBeNull();
		expect(progress.fraction).toBe(0);
	});

	test("counts a node the run came back to once, and names its visit", () => {
		const progress = runProgress(
			detail("running", [
				step("plan", 1, 2),
				step("build", 3, 4),
				step("plan", 5, null, { visit: 2 }),
			]),
		);
		expect(progress.position).toBe("Step 2 of 3");
		expect(progress.step).toBe("Plan (visit 2)");
	});

	test("leaves out the steps of a flow it calls", () => {
		const progress = runProgress(
			detail("running", [
				step("plan", 1, null),
				step("inner", 2, null, {
					scope: { parentStepId: "plan:1", itemId: null },
				}),
			]),
		);
		expect(progress.position).toBe("Step 1 of 3");
		expect(progress.step).toBe("Plan");
	});

	test("names a node without a label by its id", () => {
		const progress = runProgress(
			detail("waiting", [
				step("plan", 1, 2),
				step("build", 3, 4),
				step("review", 5, null),
			]),
		);
		expect(progress.step).toBe("review");
		expect(progress.statusText).toBe("Waiting for you");
		expect(progress.position).toBe("Step 3 of 3");
	});

	test("after the end it shows how many steps ran, and no step", () => {
		const finished = runProgress(
			detail("finished", [step("plan", 1, 2), step("review", 3, 4)]),
		);
		expect(finished.ended).toBe(true);
		expect(finished.step).toBeNull();
		expect(finished.position).toBe("Ran 2 of 3 steps");
		expect(finished.fraction).toBe(1);

		const failed = runProgress(detail("failed", [step("plan", 1, 2)]));
		expect(failed.position).toBe("Ran 1 of 3 steps");
		expect(failed.fraction).toBe(1 / 3);
		expect(failed.tone).toBe("failed");
	});

	test("an interrupted run has not ended: Night Shift resumes it after a restart", () => {
		const progress = runProgress(
			detail("interrupted", [step("plan", 1, 2), step("build", 3, 4)]),
		);
		expect(progress.ended).toBe(false);
		expect(progress.statusText).toBe("Interrupted");
	});

	test("knows when an update changes nothing", () => {
		const a = runProgress(detail("running", [step("plan", 1, null)]));
		const b = runProgress(detail("running", [step("plan", 1, null)]));
		const c = runProgress(
			detail("running", [step("plan", 1, 2), step("build", 3, null)]),
		);
		expect(sameProgress(a, b)).toBe(true);
		expect(sameProgress(a, c)).toBe(false);
	});
});
