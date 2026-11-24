import { describe, expect, test } from "bun:test";

import type { RunDetail, RunResult, RunStatus } from "../runs";
import { runProgress, sameProgress } from "./progress";
import { glanceLooks, glanceSnapshot, nowText } from "./snapshot";

type Gate = Parameters<typeof glanceSnapshot>[0]["gates"][number];

const gate = (fields: Partial<Gate> & { runId: string }): Gate => ({
	stepId: "s1",
	flowName: "triage",
	canAnswer: true,
	answerPending: false,
	deadline: null,
	openedAt: 1,
	urgency: "now",
	...fields,
});

const time = (at: number) => `t${at}`;

describe("the widget's snapshot", () => {
	test("counts only the Gates marked Now that you may answer", () => {
		const snapshot = glanceSnapshot({
			gates: [
				gate({ runId: "a" }),
				gate({ runId: "read-only", canAnswer: false }),
				gate({ runId: "sent", answerPending: true }),
				gate({ runId: "today", urgency: "today" }),
				gate({ runId: "b" }),
			],
			time,
		});
		expect(snapshot.now).toBe(2);
		expect(snapshot.nowText).toBe("2 things need you now");
		expect(snapshot.laterText).toBe("1 Gate waits for later");
	});

	test("a Gate says when to answer by, a flow says it needs a look", () => {
		const snapshot = glanceSnapshot({
			gates: [
				gate({ runId: "a", flowName: null }),
				gate({ runId: "b", deadline: { at: 730, choose: "keep" } }),
			],
			looks: [{ key: "web/deploy", flow: "deploy" }],
			time,
		});
		expect(snapshot.items).toEqual([
			{
				id: "gate:b:s1",
				flow: "triage",
				detail: "Answer by t730",
				tone: "waiting",
			},
			{
				id: "gate:a:s1",
				flow: "Quick run",
				detail: "Waits for your answer",
				tone: "waiting",
			},
			{
				id: "look:web/deploy",
				flow: "deploy",
				detail: "Needs a look",
				tone: "failed",
			},
		]);
	});

	test("shows three things and counts them all", () => {
		const snapshot = glanceSnapshot({
			gates: [gate({ runId: "a" }), gate({ runId: "b" })],
			looks: [
				{ key: "p/x", flow: "x" },
				{ key: "p/y", flow: "y" },
			],
			time,
		});
		expect(snapshot.items).toHaveLength(3);
		expect(snapshot.now).toBe(4);
	});

	test("holds no Gate questions", () => {
		const snapshot = glanceSnapshot({
			gates: [{ ...gate({ runId: "a" }), question: "Ship it?" } as never],
			time,
		});
		expect(JSON.stringify(snapshot)).not.toContain("Ship it?");
	});

	test("says how many things need you now in words", () => {
		expect(nowText(0)).toBe("Nothing needs you now");
		expect(nowText(1)).toBe("1 thing needs you now");
		expect(nowText(5)).toBe("5 things need you now");
	});
});

describe("glanceLooks", () => {
	test("only the flows with a severe signal", () => {
		expect(
			glanceLooks({
				flows: [
					{ key: "p/a", flow: "a", signals: [{ severe: true }] },
					{ key: "p/b", flow: "b", signals: [{ severe: false }] },
				],
			}),
		).toEqual([{ key: "p/a", flow: "a" }]);
		expect(glanceLooks(undefined)).toEqual([]);
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

const hasEndedStatus = (status: RunStatus) =>
	["finished", "failed", "stopped"].includes(status);

const detail = (
	status: RunStatus,
	steps: RunDetail["steps"],
	nodes = [node("plan", "Plan"), node("build", "Build"), node("review")],
	result: RunResult | null = null,
): Detail =>
	({
		id: "run-1",
		flowName: "feature",
		status,
		result,
		steps,
		createdAt: 100,
		endedAt: hasEndedStatus(status) ? 900 : null,
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
			startedAt: 100,
			endedAt: null,
			deadlineAt: null,
		});
	});

	test("counts down to the deadline of the Gate that waits", () => {
		const progress = runProgress(
			detail("waiting", [
				step("plan", 1, 2),
				step("build", 3, null, {
					gate: {
						question: "Ship it?",
						choices: [],
						openedAt: 3,
						deadline: { at: 5000, choose: "yes" },
					},
				}),
			]),
		);
		expect(progress.deadlineAt).toBe(5000);
		expect(
			runProgress(detail("running", [step("plan", 1, null)])).deadlineAt,
		).toBeNull();
	});

	test("keeps the end time of a run that ended", () => {
		expect(runProgress(detail("failed", [step("plan", 1, 2)])).endedAt).toBe(
			900,
		);
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

	test("a run that had nothing to do says so, as every screen does", () => {
		const nodes = [node("plan", "Plan")];
		const quiet = runProgress(
			detail("finished", [step("plan", 1, 2)], nodes, "nothing-to-do"),
		);
		expect(quiet).toMatchObject({
			statusText: "Nothing to do",
			tone: "finished",
			ended: true,
		});
		const done = runProgress(
			detail("finished", [step("plan", 1, 2)], nodes, "done"),
		);
		expect(done.statusText).toBe("Finished");
		expect(sameProgress(quiet, done)).toBe(false);
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
